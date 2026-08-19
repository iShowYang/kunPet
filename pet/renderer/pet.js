const pet = document.getElementById("pet");
const img = document.getElementById("pet-img");
const bubble = document.getElementById("celebrate-bubble");
const bubbleText = bubble.querySelector(".bubble-text");

const IDLE_SRC = "kun-idle.png";
const CELEBRATE_SRC = "kun-celebrate.png";
const REST_SRC = "kun-rest.png";

const CELEBRATE_MESSAGES = ["完成了！", "搞定啦！", "这轮结束～"];

let idleFlipTimer;

function pickCelebrateMessage() {
  return CELEBRATE_MESSAGES[Math.floor(Math.random() * CELEBRATE_MESSAGES.length)];
}

function setIdleFrame(useRest) {
  img.src = useRest ? REST_SRC : IDLE_SRC;
}

function startIdleCycle() {
  clearInterval(idleFlipTimer);
  setIdleFrame(false);
  idleFlipTimer = setInterval(() => {
    if (!pet.classList.contains("idle")) return;
    const currentlyRest = img.getAttribute("src") === REST_SRC;
    if (currentlyRest) {
      setIdleFrame(false);
    } else if (Math.random() < 0.35) {
      setIdleFrame(true);
    }
  }, 8000);
}

function showBubble(message) {
  bubbleText.textContent = message;
  bubble.hidden = false;
  bubble.classList.remove("is-visible");
  void bubble.offsetWidth;
  bubble.classList.add("is-visible");
}

function enterWalking(direction) {
  clearInterval(idleFlipTimer);
  pet.classList.remove("idle", "celebrate");
  pet.classList.add("walking");
  document.body.style.webkitAppRegion = "no-drag";
  img.src = IDLE_SRC;
  img.classList.toggle("face-left", direction === "left");
}

function exitWalking() {
  pet.classList.remove("walking");
  img.classList.remove("face-left");
}

function enterCelebrate() {
  exitWalking();
  clearInterval(idleFlipTimer);
  pet.classList.remove("idle");
  pet.classList.add("celebrate");
  document.body.style.webkitAppRegion = "no-drag";
  img.src = CELEBRATE_SRC;
  showBubble(pickCelebrateMessage());
}

window.kunpet.onWalkStart(({ direction }) => {
  enterWalking(direction);
});

window.kunpet.onWalkEnd(() => {
  exitWalking();
  if (!pet.classList.contains("celebrate")) {
    pet.classList.add("idle");
    document.body.style.webkitAppRegion = "drag";
    startIdleCycle();
  }
});

window.kunpet.onCelebrate(() => {
  enterCelebrate();
});

pet.addEventListener("click", () => {
  if (pet.classList.contains("celebrate")) {
    window.kunpet.dismissCelebrate();
  }
});

startIdleCycle();
