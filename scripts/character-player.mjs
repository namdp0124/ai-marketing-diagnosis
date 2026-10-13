import { characterMedia } from './character-media.mjs';

// Two layers keep the last decoded frame visible while the next clip starts.
// No per-video loop: only an ended event advances the ordered playlist.
export class CharacterPlayer {
  constructor(root, media = characterMedia) {
    this.root = root;
    this.media = media;
    this.videos = [...root.querySelectorAll('video')];
    this.button = root.querySelector('[data-playback-toggle]');
    this.button.hidden = false;
    this.status = root.querySelector('[data-playback-status]');
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.index = 0;
    this.active = 0;
    this.token = 0;
    this.userPaused = false;
    this.failed = false;
    this.inView = true;
    this.transitioning = false;
    root.querySelector('[data-character-poster]').src = media.poster;
    this.videos.forEach((video, slot) => {
      video.muted = true;
      video.defaultMuted = true;
      video.volume = 0;
      video.playsInline = true;
      video.loop = false;
      video.autoplay = slot === 0;
      video.addEventListener('volumechange', () => { if (!video.muted) video.muted = true; });
      video.addEventListener('ended', () => {
        if (slot === this.active && !this.stopped() && !this.transitioning) {
          this.start((this.index + 1) % media.clips.length, 1 - slot);
        }
      });
      video.addEventListener('error', () => { if (!this.motion.matches) this.fallback('영상을 불러오지 못해 예지의 정지 이미지를 보여드려요.'); });
    });
    this.button.addEventListener('click', () => {
      if (this.failed) {
        this.failed = false;
        this.userPaused = false;
        this.videos[this.active].load();
        this.start(this.index, this.active);
      } else {
        this.userPaused = !this.userPaused;
        this.sync();
      }
    });
    this.motion.addEventListener('change', () => {
      if (this.motion.matches) this.showPoster();
      this.sync();
    });
    document.addEventListener('visibilitychange', () => this.sync());
    if ('IntersectionObserver' in globalThis) {
      this.observer = new IntersectionObserver(entries => {
        this.inView = entries[0].isIntersecting;
        this.sync();
      }, { threshold: 0 });
      this.observer.observe(root);
    }
    this.sync();
  }

  stopped() {
    return this.motion.matches || this.userPaused || this.failed || document.hidden || !this.inView;
  }

  showPoster() {
    this.token++;
    this.transitioning = false;
    this.videos.forEach(video => { video.pause(); video.classList.remove('is-active'); });
    this.root.dataset.playback = 'poster';
  }

  fallback(message) {
    this.failed = true;
    this.showPoster();
    this.status.textContent = message;
    this.button.textContent = '다시 재생';
    this.button.setAttribute('aria-pressed', 'false');
  }

  prepare(slot, index) {
    const video = this.videos[slot];
    if (slot !== this.active) video.autoplay = false;
    if (video.getAttribute('src') !== this.media.clips[index]) {
      video.src = this.media.clips[index];
      video.preload = 'auto';
      video.load();
    }
    return video;
  }

  sync() {
    this.button.disabled = this.motion.matches;
    if (this.motion.matches) {
      this.showPoster();
      this.button.textContent = '동작 줄이기 적용';
      this.status.textContent = '기기 설정에 따라 정지 이미지를 보여드려요.';
      this.button.setAttribute('aria-pressed', 'false');
      return;
    }
    if (this.failed) return;
    if (this.stopped()) {
      this.token++;
      this.transitioning = false;
      this.videos.forEach(video => video.pause());
      this.button.textContent = '애니메이션 재생';
      this.button.setAttribute('aria-pressed', 'false');
      this.status.textContent = '잠시 쉬고 있어요.';
      return;
    }
    if (!this.transitioning) {
      const ended = this.videos[this.active].ended;
      this.start(ended ? (this.index + 1) % this.media.clips.length : this.index,
        ended ? 1 - this.active : this.active);
    }
  }

  async start(index, slot) {
    if (this.stopped()) return;
    const token = ++this.token;
    this.transitioning = true;
    const video = this.prepare(slot, index);
    const timeout = setTimeout(() => {
      if (token === this.token) this.fallback('재생을 시작하지 못해 정지 이미지를 보여드려요.');
    }, 12000);
    try {
      if (slot !== this.active || video.ended) video.currentTime = 0;
      video.muted = true;
      await video.play();
      // Wait for a decoded frame before replacing the visible layer.
      if (typeof video.requestVideoFrameCallback === 'function') {
        await new Promise(resolve => video.requestVideoFrameCallback(resolve));
      }
      if (token !== this.token || this.stopped()) return;
      this.videos.forEach((layer, i) => {
        layer.classList.toggle('is-active', i === slot);
        if (i !== slot) layer.pause();
      });
      this.active = slot;
      this.index = index;
      this.transitioning = false;
      this.root.dataset.playback = 'playing';
      this.root.dataset.clip = String(index + 1);
      this.button.textContent = '잠시 멈추기';
      this.button.setAttribute('aria-pressed', 'true');
      this.status.textContent = '예지와 눈을 맞춰보세요.';
      this.prepare(1 - slot, (index + 1) % this.media.clips.length);
    } catch {
      if (token === this.token) this.fallback('자동재생이 제한되어 정지 이미지를 보여드려요.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

document.querySelectorAll('[data-character-player]').forEach(root => new CharacterPlayer(root));
