import type { Ride } from "../ride";
import { currentStep } from "../workout";
export class RideCoach {
  #audio: AudioContext | undefined;
  #enabled = false;
  #speech = false;
  #last = "";
  #ride = "";
  #step = -1;
  async enable(enabled: boolean, speech = false): Promise<void> {
    this.#enabled = enabled;
    this.#speech = speech;
    if (!enabled) {
      this.stop();
      return;
    }
    if (typeof AudioContext === "undefined") {
      this.#enabled = false;
      throw new Error("Audio coaching is unavailable in this browser.");
    }
    try {
      this.#audio ??= new AudioContext();
      await this.#audio.resume();
    } catch (error) {
      this.#enabled = false;
      this.stop();
      throw error;
    }
    if (this.#audio.state !== "running") {
      this.#enabled = false;
      throw new Error("Click Audio cues again to enable sound.");
    }
    this.#tone(660);
  }
  update(ride: Ride | undefined): void {
    if (!this.#enabled || !ride?.workout || ride.status !== "riding") {
      this.stop();
      return;
    }
    if (ride.busy) return;
    const stage = currentStep(ride.workout, ride.workoutElapsed);
    if (this.#ride !== ride.startedAt) {
      this.#ride = ride.startedAt;
      this.#step = -1;
      this.#last = "";
    }
    if (stage.index !== this.#step) {
      this.#step = stage.index;
      this.#tone(880);
      if (this.#speech && typeof speechSynthesis !== "undefined") {
        speechSynthesis.cancel();
        const target = ride.controlMode === "erg" ? ` ${Math.round(ride.target)} watts.` : "";
        const cadence = stage.step.cadenceRpm ? ` Aim for ${stage.step.cadenceRpm} RPM.` : "";
        speechSynthesis.speak(
          new SpeechSynthesisUtterance(`${stage.step.name}.${target}${cadence}`),
        );
      }
    }
    const remaining = Math.ceil(stage.remaining);
    const key = `${stage.index}:${remaining}`;
    if (remaining > 0 && remaining <= 3 && key !== this.#last) {
      this.#last = key;
      this.#tone(440);
    }
  }
  stop(): void {
    const browser: Partial<Pick<Window, "speechSynthesis">> = globalThis;
    if (browser.speechSynthesis?.speaking) browser.speechSynthesis.cancel();
  }
  #tone(frequency: number): void {
    const audio = this.#audio;
    if (audio?.state !== "running") return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.035, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.13);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}
