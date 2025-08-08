import confetti from "canvas-confetti";

export function triggerBuyAnimation() {
  // flash the whole body background
  document.body.classList.add("trade-flash");
  setTimeout(() => document.body.classList.remove("trade-flash"), 400);

  // small confetti burst (80 pcs, nice spread)
  confetti({
    particleCount: 80,
    spread: 60,
    origin: { y: 0.6 },        // lower half of the screen
    scalar: 0.7,               // not too big
  });
}
