const { EventEmitter } = require('events');

class PromiseQueue extends EventEmitter {
  constructor(options) {
    super();
    this.resetSettings();
    this.initOptions(options || {});
  }

  resetSettings() {
    this.runningPromises = 0;
    this.lastFiredIndex = 0;
    this.lastFinishedIndex = 0;
    this.resolvers = [];
    this.rejecters = [];
    this.promiseConfigurations = [];
    this.isRunning = false;
    this.cancelRequested = false;
  }

  initOptions({ maxLimit = 10, isOrdered = true, promiseConfigurations = [] }) {
    this.maxLimit = maxLimit;
    this.isOrdered = isOrdered;

    this.addMany(promiseConfigurations);
  }

  add(promiseConfiguration) {
    if (this.isRunning) throw new Error('The queue is already processing promises');
    this.validatePromiseConfiguration(promiseConfiguration);
    this.promiseConfigurations.push(promiseConfiguration);
    this.emit('promise_added', promiseConfiguration);
  }

  validatePromiseConfiguration(promiseConfiguration) {
    if (!promiseConfiguration.promiseWrapper) throw new Error(`Promise configuration is missing 'promiseWrapper'`);
    if (!(typeof promiseConfiguration.promiseWrapper === 'function')) {
      throw new Error(`expected 'promiseWrapper' to be a function`);
    }

    if (!!promiseConfiguration.shouldFire &&
      !(typeof promiseConfiguration.promiseWrapper === 'function')) {
      throw new Error(`expected 'shouldFire' to be a function`);
    }
  }

  addMany(promiseConfigurations) {
    if (this.isRunning) throw new Error('The queue is already processing promises');
    if (!Array.isArray(promiseConfigurations)) throw new Error('addMany expects an array of promise wrappers');
    promiseConfigurations.forEach(config => this.add(config));
  }

  considerFiringMore() {
    if (this.lastFinishedIndex === this.promiseConfigurations.length) {
      this.onAllPromisesFinished();
      return false;
    }

    if (this.runningPromises < this.maxLimit &&
      this.lastFiredIndex < this.promiseConfigurations.length) {
      const promiseConfig = this.promiseConfigurations[this.lastFiredIndex];
      this.fireWrapper(promiseConfig);
      return true;
    }
  }

  isRunning() {
    return this.isRunning;
  }

  onAllPromisesFinished() {
    this.emit('all_promises_finished');
    this.isRunning = false;
    this.resetSettings();
  }

  onPromiseStarted(promiseConfiguration) {
    this.emit('promise_started', promiseConfiguration);
  }

  onPromiseCanceled(promiseConfiguration) {
    let promiseIndex = this.isOrdered ?
      promiseConfiguration.firedIndex :
      promiseConfiguration.finishedIndex;

    this.resolvers[promiseIndex](promiseConfiguration);

    this.emit('promise_canceled', promiseConfiguration);
  }

  onPromiseFinished(promiseConfiguration) {
    let promiseIndex = this.isOrdered ?
      promiseConfiguration.firedIndex :
      promiseConfiguration.finishedIndex;

    this.resolvers[promiseIndex](promiseConfiguration);

    this.emit('promise_finished', promiseConfiguration);
  }

  onPromiseFailed(promiseConfiguration) {
    let promiseIndex = this.isOrdered ?
      promiseConfiguration.firedIndex :
      promiseConfiguration.finishedIndex;

    this.rejecters[promiseIndex](promiseConfiguration);
    this.emit('promise_failed', promiseConfiguration);
  }

  shouldFire(promiseConfiguration) {
    if (this.cancelRequested) {
      promiseConfiguration.canceled = true;
      return false;
    }

    if (!promiseConfiguration.shouldFire) return true;
    else return promiseConfiguration.shouldFire();
  }

  fireWrapper(promiseConfiguration) {
    this.markPromiseStarted(promiseConfiguration);

    if (!this.shouldFire(promiseConfiguration)) {
      this.markPromiseEnded(promiseConfiguration);
      promiseConfiguration.fired = false;
      this.onPromiseCanceled(promiseConfiguration); 
      this.considerFiringMore();
    } else {
      promiseConfiguration.fired = true;

      // Fire the promise
      const promise = promiseConfiguration.promiseWrapper();
      this.onPromiseStarted(promiseConfiguration);

      let isSuccessful;
      promise
        .then(result => {
          promiseConfiguration.result = result;
          isSuccessful = true;
        })
        .catch(error => {
          promiseConfiguration.error = error;
          isSuccessful = false;
        })
        .then(() => {
          this.markPromiseEnded(promiseConfiguration);

          if (isSuccessful) this.onPromiseFinished(promiseConfiguration);
          else this.onPromiseFailed(promiseConfiguration);

          this.considerFiringMore();
        });
    }
  }

  markPromiseStarted(promiseConfiguration) {
    this.runningPromises++;
    promiseConfiguration.firedIndex = this.lastFiredIndex;
    this.lastFiredIndex++;
  }

  markPromiseEnded(promiseConfiguration) {
    this.runningPromises--;
    promiseConfiguration.finishedIndex = this.lastFinishedIndex;
    this.lastFinishedIndex++;
  }

  createResultPromises() {
    const resultPromises = [];
    for (let index = 0; index < this.promiseConfigurations.length; index++) {
      resultPromises[index] = new Promise((resolve, reject) => {
        this.resolvers[index] = resolve;
        this.rejecters[index] = reject;
      });
      resultPromises[index].catch(err => {
        this.rejecters[index](err);
      });
    }
    return resultPromises;
  }

  stop() {
    this.cancelRequested = true;
    let stillFiring = true;

    if (this.isRunning) {
      do {
        stillFiring = this.considerFiringMore();
      } while (stillFiring);
    }
  }

  run() {
    this.isRunning = true;
    let initialCount = this.maxLimit;

    const resultPromises = this.createResultPromises();
    while (initialCount--) {
      this.considerFiringMore();
    }
    return resultPromises;
  }
}

module.exports = PromiseQueue;
