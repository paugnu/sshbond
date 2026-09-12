/** Runs entirely inside the WebView; terminal output never crosses this helper. */
export const TOUCH_SCROLL_JS = String.raw`
function installTouchScroll(term, element) {
  var viewport = element.querySelector('.xterm-viewport');
  if (!viewport) return;
  var finger = null, startY = 0, lastY = 0, lastTime = 0;
  var dragging = false, pending = 0, velocity = 0, frame = 0, previousFrame = 0;
  var suppressClickUntil = 0;
  function eligible() {
    return !document.hidden && term.buffer.active.type === 'normal' && term.modes.mouseTrackingMode === 'none';
  }
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; pending = 0; velocity = 0; previousFrame = 0;
  }
  function animate(time) {
    frame = 0;
    if (!eligible()) { stop(); return; }
    var delta = pending;
    pending = 0;
    if (finger === null) {
      var elapsed = previousFrame ? Math.min(32, time - previousFrame) : 16;
      delta += velocity * elapsed;
      velocity *= Math.pow(0.94, elapsed / 16);
    }
    previousFrame = time;
    var before = viewport.scrollTop;
    viewport.scrollTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, before + delta));
    if (finger === null && (Math.abs(velocity) < 0.02 || viewport.scrollTop === before)) { stop(); return; }
    if (finger === null || pending) frame = requestAnimationFrame(animate);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(animate); }
  function swallow(event) {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }
  element.addEventListener('touchstart', function (event) {
    stop(); finger = null; dragging = false;
    if (event.touches.length !== 1 || !eligible()) return;
    var touch = event.touches[0];
    finger = touch.identifier; startY = lastY = touch.clientY; lastTime = performance.now();
    // Only this handler moves the scrollback; xterm's bubble handler must not also scroll it.
    event.stopImmediatePropagation();
  }, { capture: true, passive: true });
  element.addEventListener('touchmove', function (event) {
    if (finger === null) return;
    if (event.touches.length !== 1 || !eligible()) { finger = null; stop(); return; }
    var touch = event.touches[0];
    if (touch.identifier !== finger) return;
    var now = performance.now();
    var delta = lastY - touch.clientY;
    if (!dragging && Math.abs(touch.clientY - startY) >= 5) dragging = true;
    if (dragging) {
      pending += delta;
      velocity = Math.max(-3, Math.min(3, delta / Math.max(8, now - lastTime)));
      schedule();
    }
    lastY = touch.clientY; lastTime = now;
    // Claim the drag even at a boundary, so WebKit does not take over midway.
    if (dragging) swallow(event);
    else event.stopImmediatePropagation();
  }, { capture: true, passive: false });
  element.addEventListener('touchend', function (event) {
    if (finger === null) return;
    finger = null;
    if (!dragging) { stop(); return; }
    swallow(event);
    suppressClickUntil = performance.now() + 500;
    if (performance.now() - lastTime > 80) velocity = 0;
    previousFrame = 0;
    schedule();
  }, { capture: true, passive: false });
  element.addEventListener('touchcancel', function () { finger = null; dragging = false; stop(); }, { capture: true });
  ['mousedown', 'click'].forEach(function (name) {
    element.addEventListener(name, function (event) {
      if (performance.now() < suppressClickUntil) swallow(event);
    }, { capture: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { finger = null; stop(); }
  });
  window.addEventListener('blur', function () { finger = null; stop(); });
}
`;
