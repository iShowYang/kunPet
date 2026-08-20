const pet = document.getElementById("pet");
const img = document.getElementById("pet-img");
const bubble = document.getElementById("celebrate-bubble");
const bubbleText = bubble.querySelector(".bubble-text");

/** 平常待机：抱篮球睡觉 */
const REST_SRC = "kun-rest.png";
/** 对话进行中：插兜 wink */
const WORKING_SRC = "kun-idle.png";
/** 完成庆祝：竖大拇指 */
const CELEBRATE_SRC = "kun-celebrate.png";

const CELEBRATE_MESSAGES = ["完成了！", "搞定啦！", "这轮结束～"];

function pickCelebrateMessage() {
  return CELEBRATE_MESSAGES[Math.floor(Math.random() * CELEBRATE_MESSAGES.length)];
}

function showBubble(message) {
  bubbleText.textContent = message;
  bubble.hidden = false;
  bubble.classList.remove("is-visible");
  void bubble.offsetWidth;
  bubble.classList.add("is-visible");
}

function hideBubble() {
  bubble.hidden = true;
  bubble.classList.remove("is-visible");
}

function enterIdle() {
  pet.classList.remove("celebrate", "walking", "working");
  pet.classList.add("idle");
  document.body.style.webkitAppRegion = "drag";
  img.classList.remove("face-left");
  img.style.transform = "";
  img.src = REST_SRC;
  hideBubble();
}

function enterWorking() {
  pet.classList.remove("celebrate", "walking", "idle");
  pet.classList.add("working");
  document.body.style.webkitAppRegion = "drag";
  img.classList.remove("face-left");
  img.style.transform = "";
  img.src = WORKING_SRC;
  hideBubble();
}

function enterWalking(direction) {
  pet.classList.remove("idle", "celebrate", "working");
  pet.classList.add("walking");
  document.body.style.webkitAppRegion = "no-drag";
  img.src = WORKING_SRC;
  img.classList.toggle("face-left", direction === "left");
  img.style.transform = "";
}

function exitWalking() {
  pet.classList.remove("walking");
  img.classList.remove("face-left");
  img.style.transform = "";
}

function applyWalkFrame({ scale, rotate }) {
  const s = typeof scale === "number" ? scale : 1;
  const r = typeof rotate === "number" ? rotate : 0;
  const face = img.classList.contains("face-left") ? " scaleX(-1)" : "";
  img.style.transform = `scale(${s}) rotate(${r}deg)${face}`;
}

function enterCelebrate() {
  exitWalking();
  pet.classList.remove("idle", "working");
  pet.classList.add("celebrate");
  document.body.style.webkitAppRegion = "no-drag";
  img.style.transform = "";
  img.src = CELEBRATE_SRC;
  showBubble(pickCelebrateMessage());
}

window.kunpet.onWalkStart(({ direction }) => {
  enterWalking(direction);
});

window.kunpet.onWalkFrame((payload) => {
  if (!pet.classList.contains("walking")) return;
  applyWalkFrame(payload || {});
});

window.kunpet.onWalkEnd(() => {
  exitWalking();
});

window.kunpet.onCelebrate(() => {
  enterCelebrate();
});

window.kunpet.onIdle(() => {
  enterIdle();
});

window.kunpet.onWorking(() => {
  enterWorking();
});

pet.addEventListener("click", () => {
  if (pet.classList.contains("celebrate")) {
    window.kunpet.dismissCelebrate();
  }
});

enterIdle();
