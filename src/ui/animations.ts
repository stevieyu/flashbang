export function flashAnim(el: HTMLElement) {
  el.classList.remove("flash-anim");
  void el.offsetWidth; // force reflow to restart CSS animation
  el.classList.add("flash-anim");
  setTimeout(() => el.classList.remove("flash-anim"), 300);
}

export function shakeAnim(el: HTMLElement) {
  el.classList.remove("shake-anim");
  void el.offsetWidth; // force reflow to restart CSS animation
  el.classList.add("shake-anim");
  setTimeout(() => el.classList.remove("shake-anim"), 200);
}
