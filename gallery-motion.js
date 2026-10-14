// Pure signed-velocity controller. It never owns or resets the gallery phase.
const LN20 = Math.log(20);
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback) => {
  const number = finite(value, fallback);
  return number > 0 ? number : fallback;
};
const sign = value => value > 0 ? 1 : value < 0 ? -1 : 0;
const clamp = (value, maximum) => Math.max(-maximum, Math.min(maximum, value));

export class GalleryMotion {
  #settings;
  #width = 1024;
  #maxSpeed;
  #lastAdvance = null;
  #events = [];
  #state;
  #observed;

  constructor(settings = {}) {
    this.#settings = Object.freeze({
      slowSpeed: Math.max(0, finite(settings.homeSpeed, 44)),
      maxScreensPerSecond: positive(settings.homeMaxScreensPerSecond, 2.5),
      accelerationSeconds: positive(settings.homeAccelerationSeconds, .1),
      idleSeconds: Math.max(0, finite(settings.homeIdleMilliseconds, 100)) / 1000,
      decelerationSeconds: positive(settings.homeDecelerationSeconds, .4),
      fullInputScreensPerSecond: positive(settings.homeFullInputScreensPerSecond, .65),
      curvePower: positive(settings.homeVelocityCurvePower, 1.75),
      edgeMaxScreensPerSecond: positive(settings.homeEdgeMaxScreensPerSecond, 1),
      edgeZoneRatio: Math.min(.5, positive(settings.homeEdgeZoneRatio, .35)),
      edgeAccelerationSeconds: positive(settings.homeEdgeAccelerationSeconds, .5),
    });
    // The reference gallery initially travels left. Any accepted horizontal
    // input replaces this direction; rightward input always means positive.
    const direction = sign(finite(settings.homeDirection, -1)) || -1;
    this.#maxSpeed = this.#width * this.#settings.maxScreensPerSecond;
    const speed = direction * Math.min(this.#settings.slowSpeed, this.#maxSpeed);
    this.#state = { speed, target: speed, direction, inputVelocity: 0, inputAt: -Infinity, mode: 'idle', hoverX: null, decayAt: 0, decayFrom: speed };
    this.#observed = { ...this.#state };
  }

  get speed() { return this.#observed.speed; }
  get target() { return this.#observed.target; }
  get inputVelocity() { return this.#observed.inputVelocity; }
  get lastDirection() { return this.#observed.direction; }
  get lastInputTime() { return this.#observed.inputAt; }
  get mode() { return this.#observed.mode; }
  get maxSpeed() { return this.#maxSpeed; }
  get max() { return this.#maxSpeed; }
  get edgeMaxSpeed() { return Math.min(this.#maxSpeed, this.#width * this.#settings.edgeMaxScreensPerSecond); }
  get hoverPosition() { return this.#observed.hoverX; }

  #viewport(viewportWidth) {
    const width = finite(viewportWidth, this.#width);
    if (width > 0) this.#width = width;
    this.#maxSpeed = this.#width * this.#settings.maxScreensPerSecond;
    this.#state.speed = clamp(this.#state.speed, this.#maxSpeed);
    this.#state.decayFrom = clamp(this.#state.decayFrom, this.#maxSpeed);
    this.#state.target = clamp(this.#state.target, this.#maxSpeed);
    this.#observed.speed = clamp(this.#observed.speed, this.#maxSpeed);
    this.#observed.target = clamp(this.#observed.target, this.#maxSpeed);
  }

  #time(nowSeconds) {
    return Math.max(this.#lastAdvance ?? 0, finite(nowSeconds, this.#lastAdvance ?? 0));
  }

  #slowTarget(direction) {
    return direction * Math.min(this.#settings.slowSpeed, this.#maxSpeed);
  }

  #inputTarget(velocity) {
    const slow = Math.min(this.#settings.slowSpeed, this.#maxSpeed);
    const progress = Math.min(Math.abs(velocity) / (this.#width * this.#settings.fullInputScreensPerSecond), 1);
    return sign(velocity) * (slow + (this.#maxSpeed - slow) * progress ** this.#settings.curvePower);
  }

  #edgeTarget(position) {
    if (position === null) return null;
    const zone = this.#settings.edgeZoneRatio;
    const direction = position < zone ? -1 : position > 1 - zone ? 1 : 0;
    if (!direction) return null;
    const progress = direction < 0 ? (zone - position) / zone : (position - (1 - zone)) / zone;
    const eased = progress * progress * (3 - 2 * progress);
    const maximum = this.edgeMaxSpeed;
    const slow = Math.min(this.#settings.slowSpeed, maximum);
    return direction * (slow + (maximum - slow) * eased);
  }

  #movementDirection(state) {
    return Math.abs(state.speed) > .001 ? sign(state.speed) : state.direction;
  }

  #selectHover(time) {
    const state = this.#state;
    if (state.mode === 'active') return;
    const target = this.#edgeTarget(state.hoverX);
    if (target !== null) {
      state.mode = 'edge';
      state.target = target;
      state.direction = sign(target);
      state.inputVelocity = 0;
    } else if (state.mode === 'edge') {
      state.direction = this.#movementDirection(state);
      this.#startDecay(time);
    }
  }

  /** Store the normalized gallery position, independent of mouse velocity.
   *  Left/right 35% zones have signed fixed targets; .35..65 is the center.
   *  Recent horizontal input owns the controller for 100ms before this target
   *  takes over automatically. null only clears the waiting hover target;
   *  call leave() for immediate decay when actually leaving the gallery.
   */
  hover(normalizedXOrNull, nowSeconds, viewportWidth) {
    this.#viewport(viewportWidth);
    const position = typeof normalizedXOrNull === 'number' && Number.isFinite(normalizedXOrNull) ? Math.max(0, Math.min(1, normalizedXOrNull)) : null;
    const time = this.#time(nowSeconds);
    this.#observed.hoverX = position;
    const active = this.#observed.mode === 'active' && time < this.#observed.inputAt + this.#settings.idleSeconds;
    if (!active) {
      const target = this.#edgeTarget(position);
      if (target !== null) {
        this.#observed = { ...this.#observed, target, direction: sign(target), inputVelocity: 0, mode: 'edge' };
      } else if (this.#observed.mode === 'edge') {
        const direction = this.#movementDirection(this.#observed);
        this.#observed = { ...this.#observed, target: this.#slowTarget(direction), direction, inputVelocity: 0, mode: 'decay' };
      }
    }
    this.#events.push({ time, type: 'hover', position });
  }

  /** deltaX is in pixels; elapsedSeconds and nowSeconds are in seconds.
   *  Returns false for vertical-only motion and sub-.5px horizontal noise.
   */
  pointer(deltaX, elapsedSeconds, nowSeconds, viewportWidth) {
    const delta = finite(deltaX, 0);
    if (Math.abs(delta) < .5) return false;
    this.#viewport(viewportWidth);
    const velocity = delta / Math.max(.008, finite(elapsedSeconds, .008));
    const time = this.#time(nowSeconds);
    const direction = sign(velocity);
    const target = this.#inputTarget(velocity);
    this.#observed = { ...this.#observed, inputVelocity: velocity, inputAt: time, direction, target, mode: 'active' };
    this.#events.push({ time, type: 'pointer', velocity, direction });
    return true;
  }

  /** Begin decay immediately along the currently displayed movement direction.
   *  Near zero, the last horizontal input direction provides the fallback.
   */
  leave(nowSeconds) {
    const direction = Math.abs(this.speed) > .001 ? sign(this.speed) : this.lastDirection;
    const mode = this.mode === 'paused' ? this.#state.mode : this.mode;
    // Repeated outside/blur notifications cannot postpone the slow-speed deadline.
    const sameDecay = (mode === 'decay' || mode === 'idle') && this.lastDirection === direction;
    const hadHover = this.#observed.hoverX !== null;
    this.#observed.hoverX = null;
    if (sameDecay && !hadHover) return;
    const time = this.#time(nowSeconds);
    this.#observed = { ...this.#observed, direction, target: this.#slowTarget(direction), inputVelocity: 0, mode: 'decay' };
    if (sameDecay) this.#observed.mode = mode;
    this.#events.push({ time, type: 'leave', direction, preserveDecay: sameDecay });
  }

  /** Gesture velocity is signed px/s. A nonzero velocity determines its own
   *  direction; direction is only a fallback when velocity is near zero.
   */
  releaseDrag(velocity, direction, nowSeconds, viewportWidth) {
    this.#viewport(viewportWidth);
    const seed = clamp(finite(velocity, 0), this.#maxSpeed);
    const nextDirection = Math.abs(seed) > .001 ? sign(seed) : (sign(finite(direction, 0)) || this.lastDirection);
    const time = this.#time(nowSeconds);
    const edgeTarget = this.#edgeTarget(this.#observed.hoverX);
    this.#observed = { ...this.#observed, speed: seed, target: edgeTarget ?? this.#slowTarget(nextDirection), direction: edgeTarget === null ? nextDirection : sign(edgeTarget), inputVelocity: 0, mode: edgeTarget === null ? 'decay' : 'edge' };
    this.#events.push({ time, type: 'release', velocity: seed, direction: nextDirection });
  }

  #apply(event) {
    const state = this.#state;
    if (event.type === 'hover') {
      state.hoverX = event.position;
      this.#selectHover(event.time);
      return;
    }
    state.direction = event.direction;
    if (event.type === 'pointer') {
      state.inputVelocity = event.velocity;
      state.inputAt = event.time;
      state.target = this.#inputTarget(event.velocity);
      state.mode = 'active';
    } else {
      if (event.type === 'release') state.speed = clamp(event.velocity, this.#maxSpeed);
      if (event.type === 'leave') state.hoverX = null;
      if (!event.preserveDecay) this.#startDecay(event.time);
      if (event.type === 'release') this.#selectHover(event.time);
    }
  }

  #startDecay(time) {
    const state = this.#state;
    state.mode = 'decay';
    state.inputVelocity = 0;
    state.target = this.#slowTarget(state.direction);
    state.decayAt = time;
    state.decayFrom = state.speed;
  }

  #decayIfIdle(time) {
    if (this.#state.mode === 'active' && time >= this.#state.inputAt + this.#settings.idleSeconds - 1e-10) {
      const handoffTime = this.#state.inputAt + this.#settings.idleSeconds;
      this.#state.direction = this.#movementDirection(this.#state);
      this.#startDecay(handoffTime);
      this.#selectHover(handoffTime);
    }
  }

  #finishDecay(time) {
    if (this.#state.mode === 'decay' && time >= this.#state.decayAt + this.#settings.decelerationSeconds - 1e-10) {
      this.#state.speed = this.#slowTarget(this.#state.direction);
      this.#state.target = this.#state.speed;
      this.#state.mode = 'idle';
    }
  }

  #integrate(seconds, paused, startTime) {
    if (paused) { this.#state.speed = 0; return 0; }
    if (seconds <= 0) return 0;
    const state = this.#state;
    if (state.mode === 'idle') return state.speed * seconds;
    if (state.mode === 'decay') {
      const duration = this.#settings.decelerationSeconds;
      const remainder = time => Math.max(0, Math.min(1, 1 - (time - state.decayAt) / duration));
      const from = remainder(startTime);
      const to = remainder(startTime + seconds);
      const difference = state.decayFrom - state.target;
      // The cubic ease-out reaches the slow speed exactly at its deadline.
      // Integrating the polynomial avoids frame-rate-dependent displacement.
      const displacement = state.target * seconds + difference * duration / 4 * (from ** 4 - to ** 4);
      state.speed = clamp(state.target + difference * to ** 3, this.#maxSpeed);
      if (to < 1e-9) { state.speed = state.target; state.mode = 'idle'; }
      return displacement;
    }
    const rate = LN20 / (state.mode === 'edge' ? this.#settings.edgeAccelerationSeconds : this.#settings.accelerationSeconds);
    const difference = state.speed - state.target;
    const remaining = Math.exp(-rate * seconds);
    // Exact first-order velocity integral, including a smooth zero crossing.
    const displacement = state.target * seconds + difference * (-Math.expm1(-rate * seconds)) / rate;
    state.speed = clamp(state.target + difference * remaining, this.#maxSpeed);
    return displacement;
  }

  /** Advance once per animation frame. The first call has no displacement.
   *  Add returned displacement to the externally owned gallery phase.
   *  A long frame integrates at most .05s, so hidden tabs cannot catch up.
   */
  advance(nowSeconds, viewportWidth, paused = false) {
    this.#viewport(viewportWidth);
    const now = this.#time(nowSeconds);
    const seconds = this.#lastAdvance === null ? 0 : Math.min(.05, Math.max(0, now - this.#lastAdvance));
    let cursor = now - seconds;
    let displacement = 0;
    // Event timestamps prevent a new pointer target from affecting time before
    // the input occurred. Earlier events are applied without background travel.
    this.#events.sort((a, b) => a.time - b.time);
    while (this.#events.length && this.#events[0].time <= cursor) this.#apply(this.#events.shift());
    this.#decayIfIdle(cursor);
    this.#finishDecay(cursor);
    this.#state.target = this.#state.mode === 'active' ? this.#inputTarget(this.#state.inputVelocity) : this.#state.mode === 'edge' ? this.#edgeTarget(this.#state.hoverX) : this.#slowTarget(this.#state.direction);
    if (this.#state.mode === 'idle') this.#state.speed = this.#state.target;
    while (cursor < now) {
      const eventTime = this.#events.length ? this.#events[0].time : Infinity;
      const idleTime = this.#state.mode === 'active' ? this.#state.inputAt + this.#settings.idleSeconds : Infinity;
      const boundary = Math.max(cursor, Math.min(now, eventTime, idleTime));
      displacement += this.#integrate(boundary - cursor, paused, cursor);
      cursor = boundary;
      this.#decayIfIdle(cursor);
      while (this.#events.length && this.#events[0].time <= cursor) this.#apply(this.#events.shift());
    }
    // Zero-duration frames still apply events and expose automatic idle decay.
    while (this.#events.length && this.#events[0].time <= now) this.#apply(this.#events.shift());
    this.#decayIfIdle(now);
    this.#finishDecay(now);
    if (paused) {
      this.#state.speed = 0;
      // Resume a paused decay from rest, never from its stale gesture speed.
      if (this.#state.mode !== 'active' && this.#state.mode !== 'edge') this.#startDecay(now);
    }
    this.#lastAdvance = now;
    this.#observed = { ...this.#state, ...(paused ? { speed: 0, target: 0, mode: 'paused' } : {}) };
    return {
      speed: this.speed,
      target: this.target,
      displacement: paused ? 0 : displacement,
      inputVelocity: this.inputVelocity,
      direction: this.lastDirection,
      mode: this.mode,
      maxSpeed: this.maxSpeed,
    };
  }
}
