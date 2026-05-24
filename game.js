(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const TILE = 48;
  const GRAVITY = 0.55;

  class AudioEngine {
    constructor() { this.ctx = null; }
    ensure() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    beep(freq, duration, type = "square", gain = 0.05) {
      this.ensure();
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = gain;
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start();
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.stop(this.ctx.currentTime + duration);
    }
    jump() { this.beep(340, 0.12, "square"); }
    collect() { this.beep(620, 0.1, "triangle"); }
    damage() { this.beep(120, 0.25, "sawtooth"); }
    stomp() { this.beep(220, 0.08, "square"); }
    win() { this.beep(700, 0.08, "triangle"); setTimeout(() => this.beep(880, 0.12, "triangle"), 90); }
  }

  const keys = {};
  addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    keys[key] = true;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) e.preventDefault();
  });
  addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  const levelData = [
    { width: 80, spawn: { x: 2 * TILE, y: 8 * TILE }, goalX: 75 * TILE,
      pits: [[14, 16], [33, 35], [51, 52]],
      platforms: [[0, 11, 13], [16, 11, 17], [20, 11, 12], [36, 11, 15], [53, 11, 27], [8, 8, 3], [24, 8, 4], [41, 7, 4], [61, 8, 3]],
      breakables: [{ x: 10, y: 7 }, { x: 11, y: 7 }, { x: 45, y: 6 }, { x: 46, y: 6 }],
      mystery: [{ x: 13, y: 7 }, { x: 25, y: 7 }, { x: 63, y: 7 }],
      collectibles: [{ x: 9, y: 6 }, { x: 26, y: 6 }, { x: 42, y: 5 }, { x: 65, y: 6 }, { x: 72, y: 9 }],
      enemies: [{ x: 18, y: 10 }, { x: 28, y: 10 }, { x: 43, y: 6 }, { x: 58, y: 10 }, { x: 68, y: 10 }]
    },
    { width: 45, spawn: { x: 2 * TILE, y: 8 * TILE }, goalX: 40 * TILE,
      pits: [[12, 13], [23, 24]],
      platforms: [[0, 11, 12], [14, 11, 9], [25, 11, 20], [7, 8, 2], [17, 7, 3], [31, 8, 3]],
      breakables: [{ x: 19, y: 6 }], mystery: [{ x: 8, y: 7 }, { x: 32, y: 7 }], collectibles: [{ x: 8, y: 6 }, { x: 18, y: 6 }, { x: 32, y: 6 }, { x: 38, y: 9 }], enemies: [{ x: 16, y: 10 }, { x: 29, y: 10 }, { x: 35, y: 10 }]
    }
  ];

  const aabb = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  class Player {
    constructor(spawn) {
      this.w = 34;
      this.h = 42;
      this.lives = 3;
      this.score = 0;
      this.gems = 0;
      this.reset(spawn);
    }
    reset(spawn) {
      this.x = spawn.x;
      this.y = spawn.y;
      this.vx = 0;
      this.vy = 0;
      this.onGround = false;
      this.inv = 0;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumpHold = 0;
    }
    get rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  }

  class Game {
    constructor() {
      this.audio = new AudioEngine();
      this.state = "start";
      this.levelIdx = 0;
      this.shake = 0;
      this.cameraX = 0;
      this.loadLevel(0);
      this.last = 0;
      requestAnimationFrame((t) => this.loop(t));
    }

    loadLevel(i) {
      this.levelIdx = i;
      this.level = structuredClone(levelData[i]);
      this.level.enemies = this.level.enemies.map((e) => ({ x: e.x * TILE, y: e.y * TILE + 12, w: 34, h: 28, vx: -1.4, dead: false }));
      this.level.collectibles = this.level.collectibles.map((c) => ({ x: c.x * TILE + 14, y: c.y * TILE + 14, got: false }));
      this.player = this.player || new Player(this.level.spawn);
      this.player.reset(this.level.spawn);
      this.usedBlocks = new Set();
      this.usedMystery = new Set();
      this.cameraX = 0;
      this.lastP = false;
      this.lastEnter = false;
      this.lastR = false;
    }

    loseLife() {
      if (this.player.inv > 0) return;
      this.player.lives--;
      this.player.inv = 110;
      this.audio.damage();
      this.shake = 8;
      if (this.player.lives <= 0) this.state = "gameover";
      else this.player.reset(this.level.spawn);
    }

    solidBlocks() {
      const blocks = [];
      this.level.platforms.forEach(([x, y, w]) => blocks.push({ x: x * TILE, y: y * TILE, w: w * TILE, h: TILE, type: "ground" }));
      this.level.breakables.forEach((b, i) => {
        if (!this.usedBlocks.has(`b${i}`)) blocks.push({ x: b.x * TILE, y: b.y * TILE, w: TILE, h: TILE, type: "break", i });
      });
      this.level.mystery.forEach((b, i) => blocks.push({ x: b.x * TILE, y: b.y * TILE, w: TILE, h: TILE, type: "mystery", i }));
      return blocks;
    }

    updatePlayer() {
      const p = this.player;
      const left = keys["arrowleft"] || keys.a;
      const right = keys["arrowright"] || keys.d;
      const jump = keys[" "] || keys["arrowup"] || keys.w;

      if (left) p.vx -= 0.75;
      if (right) p.vx += 0.75;
      if (!left && !right) p.vx *= 0.82;
      p.vx = Math.max(-6, Math.min(6, p.vx));

      p.jumpBuffer = jump ? 8 : Math.max(0, p.jumpBuffer - 1);
      p.coyote = p.onGround ? 8 : Math.max(0, p.coyote - 1);

      if (p.jumpBuffer > 0 && p.coyote > 0) {
        p.vy = -11.4;
        p.onGround = false;
        p.coyote = 0;
        p.jumpBuffer = 0;
        p.jumpHold = 8;
        this.audio.jump();
      }

      if (jump && p.jumpHold > 0) {
        p.vy -= 0.22;
        p.jumpHold--;
      } else {
        p.jumpHold = 0;
      }
      if (!jump && p.vy < 0) p.vy *= 0.92;

      p.vy += GRAVITY;
      p.vy = Math.min(14, p.vy);

      p.x += p.vx;
      this.resolvePlayerAxis("x");
      p.y += p.vy;
      p.onGround = false;
      this.resolvePlayerAxis("y");
    }

    resolvePlayerAxis(axis) {
      const p = this.player;
      for (const b of this.solidBlocks()) {
        if (!aabb(p.rect, b)) continue;
        if (axis === "x") {
          if (p.vx > 0) p.x = b.x - p.w;
          else if (p.vx < 0) p.x = b.x + b.w;
          p.vx = 0;
        } else {
          if (p.vy > 0) {
            p.y = b.y - p.h;
            p.vy = 0;
            p.onGround = true;
          } else if (p.vy < 0) {
            p.y = b.y + b.h;
            p.vy = 0;
            if (b.type === "break") {
              this.usedBlocks.add(`b${b.i}`);
              this.player.score += 75;
              this.audio.stomp();
              this.shake = 7;
            }
            if (b.type === "mystery" && !this.usedMystery.has(`m${b.i}`)) {
              this.usedMystery.add(`m${b.i}`);
              this.level.collectibles.push({ x: b.x + 14, y: b.y - 24, got: false });
              this.player.score += 25;
              this.audio.collect();
            }
          }
        }
      }
    }

    enemyNeedsTurn(enemy) {
      const dir = Math.sign(enemy.vx) || -1;
      const frontX = dir > 0 ? enemy.x + enemy.w + 3 : enemy.x - 3;
      const footY = enemy.y + enemy.h + 2;
      const wallProbe = { x: frontX, y: enemy.y + 2, w: 2, h: enemy.h - 4 };
      const wallAhead = this.solidBlocks().some((b) => aabb(wallProbe, b));
      const floorAhead = this.solidBlocks().some((b) => frontX >= b.x && frontX <= b.x + b.w && footY >= b.y && footY <= b.y + b.h);
      const pitAhead = this.level.pits.some(([a, c]) => frontX >= a * TILE && frontX <= c * TILE);
      return wallAhead || !floorAhead || pitAhead;
    }

    updateEnemies() {
      for (const e of this.level.enemies) {
        if (e.dead) continue;
        if (this.enemyNeedsTurn(e)) e.vx *= -1;
        e.x += e.vx;

        if (aabb(this.player.rect, e)) {
          const playerBottom = this.player.y + this.player.h;
          if (this.player.vy > 0 && playerBottom - 10 < e.y) {
            e.dead = true;
            this.player.vy = -8.5;
            this.player.score += 100;
            this.audio.stomp();
            this.shake = 5;
          } else {
            this.loseLife();
          }
        }
      }
    }

    updateCollectibles() {
      const p = this.player;
      for (const c of this.level.collectibles) {
        if (c.got) continue;
        if (aabb(p.rect, { x: c.x, y: c.y, w: 20, h: 20 })) {
          c.got = true;
          p.gems++;
          p.score += 50;
          this.audio.collect();
        }
      }
    }

    update() {
      const p = this.player;

      if (this.state === "start") {
        if (keys.enter && !this.lastEnter) { this.state = "playing"; this.audio.ensure(); }
        this.lastEnter = keys.enter;
        return;
      }

      if ((keys.p && !this.lastP) && ["playing", "paused"].includes(this.state)) {
        this.state = this.state === "playing" ? "paused" : "playing";
      }
      this.lastP = keys.p;

      if (keys.r && !this.lastR) {
        p.lives = 3;
        p.score = 0;
        p.gems = 0;
        this.loadLevel(0);
        this.state = "start";
      }
      this.lastR = keys.r;

      if (this.state !== "playing") return;

      this.updatePlayer();
      this.updateEnemies();
      this.updateCollectibles();

      if (p.y > HEIGHT + 140 || this.level.pits.some(([a, b]) => p.x + p.w / 2 >= a * TILE && p.x + p.w / 2 <= b * TILE && p.y + p.h > 11 * TILE - 1)) {
        this.loseLife();
      }

      if (p.x > this.level.goalX) {
        if (this.levelIdx < levelData.length - 1) {
          this.audio.win();
          this.loadLevel(this.levelIdx + 1);
        } else {
          this.state = "win";
          this.audio.win();
        }
      }

      if (p.inv > 0) p.inv--;

      const targetCamera = Math.max(0, Math.min(this.level.width * TILE - WIDTH, p.x - WIDTH * 0.35));
      this.cameraX += (targetCamera - this.cameraX) * 0.14;
      this.shake = Math.max(0, this.shake - 0.5);
    }

    drawWorld() {
      ctx.fillStyle = "#8fd9ff";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = "#d7f2ff";
        ctx.fillRect((i * 231 - this.cameraX * 0.25) % 1300, 55 + (i % 6) * 8, 34, 8);
      }

      ctx.fillStyle = "#86b34a";
      for (let x = 0; x < this.level.width * TILE; x += TILE) {
        const inPit = this.level.pits.some(([a, b]) => x + TILE / 2 >= a * TILE && x + TILE / 2 <= b * TILE);
        if (!inPit) ctx.fillRect(x - this.cameraX, 11 * TILE, TILE, TILE);
      }

      for (const b of this.solidBlocks()) {
        const sx = b.x - this.cameraX;
        if (sx < -TILE || sx > WIDTH + TILE) continue;
        if (b.type === "ground") ctx.fillStyle = "#6e9440";
        if (b.type === "break") ctx.fillStyle = "#b06b45";
        if (b.type === "mystery") ctx.fillStyle = this.usedMystery.has(`m${b.i}`) ? "#4d4b7b" : "#6d59c9";
        ctx.fillRect(sx, b.y, b.w, b.h);
        if (b.type === "mystery" && !this.usedMystery.has(`m${b.i}`)) {
          ctx.fillStyle = "#d0c8ff";
          ctx.font = "24px monospace";
          ctx.fillText("✦", sx + 12, b.y + 30);
        }
      }

      for (const c of this.level.collectibles) {
        if (c.got) continue;
        const sx = c.x - this.cameraX;
        ctx.fillStyle = "#48ffd8";
        ctx.beginPath();
        ctx.moveTo(sx + 10, c.y);
        ctx.lineTo(sx + 20, c.y + 10);
        ctx.lineTo(sx + 10, c.y + 20);
        ctx.lineTo(sx, c.y + 10);
        ctx.fill();
      }

      for (const e of this.level.enemies) {
        if (e.dead) continue;
        const sx = e.x - this.cameraX;
        ctx.fillStyle = "#f56a7d";
        ctx.fillRect(sx, e.y, e.w, e.h);
        ctx.fillStyle = "#2b2039";
        ctx.fillRect(sx + 6, e.y + 8, 6, 6);
        ctx.fillRect(sx + 22, e.y + 8, 6, 6);
      }

      const p = this.player;
      const squish = p.onGround ? Math.max(0, Math.abs(p.vx) * 0.2) : 0;
      const pw = p.w + squish;
      const ph = p.h - squish;
      const blink = p.inv > 0 && Math.floor(p.inv / 6) % 2 === 0;
      if (!blink) {
        ctx.fillStyle = "#4e7bff";
        ctx.fillRect(p.x - this.cameraX - (squish / 2), p.y + (squish / 2), pw, ph);
        ctx.fillStyle = "#c6e0ff";
        ctx.fillRect(p.x - this.cameraX + 8, p.y + 8, 18, 12);
      }

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(this.level.goalX - this.cameraX, 8 * TILE, 8, 3 * TILE);
      ctx.fillStyle = "#66f0d6";
      ctx.fillRect(this.level.goalX - this.cameraX + 8, 8 * TILE, 28, 18);
    }

    drawHud() {
      const p = this.player;
      ctx.fillStyle = "rgba(11,20,32,0.82)";
      ctx.fillRect(10, 10, WIDTH - 20, 40);
      ctx.strokeStyle = "rgba(102,240,214,0.55)";
      ctx.strokeRect(10, 10, WIDTH - 20, 40);
      ctx.fillStyle = "#ebf2ff";
      ctx.font = "20px monospace";
      ctx.fillText(`Score: ${p.score}`, 24, 37);
      ctx.fillText(`Lives: ${p.lives}`, 220, 37);
      ctx.fillText(`Gems: ${p.gems}`, 360, 37);
      ctx.fillText(`Level: ${this.levelIdx + 1}/${levelData.length}`, 510, 37);
      if (this.state === "playing") {
        ctx.fillStyle = "rgba(235,242,255,0.85)";
        ctx.font = "16px monospace";
        ctx.fillText("P: Pause  R: Restart", WIDTH - 250, 37);
      }
    }

    overlay() {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      if (this.state === "start") {
        ctx.font = "bold 52px monospace";
        ctx.fillText("Pixel Plumber Adventure", WIDTH / 2, 165);
        ctx.font = "24px monospace";
        ctx.fillText("Move: A/D or Arrows   Jump: W/Up/Space", WIDTH / 2, 245);
        ctx.fillText("Jump timing includes coyote + variable hold", WIDTH / 2, 285);
        ctx.fillText("P: Pause   R: Restart", WIDTH / 2, 325);
        ctx.fillText("Press Enter to Begin", WIDTH / 2, 385);
      } else if (this.state === "paused") {
        ctx.font = "bold 56px monospace";
        ctx.fillText("PAUSED", WIDTH / 2, 250);
        ctx.font = "24px monospace";
        ctx.fillText("Press P to Resume", WIDTH / 2, 300);
      } else if (this.state === "gameover") {
        ctx.font = "bold 56px monospace";
        ctx.fillText("GAME OVER", WIDTH / 2, 240);
        ctx.font = "24px monospace";
        ctx.fillText("Press R to Restart", WIDTH / 2, 300);
      } else if (this.state === "win") {
        ctx.font = "bold 56px monospace";
        ctx.fillText("YOU WIN!", WIDTH / 2, 230);
        ctx.font = "24px monospace";
        ctx.fillText("All levels complete.", WIDTH / 2, 280);
        ctx.fillText("Press R to Play Again", WIDTH / 2, 320);
      }
      ctx.textAlign = "left";
    }

    draw() {
      const shakeX = (Math.random() - 0.5) * this.shake;
      const shakeY = (Math.random() - 0.5) * this.shake;
      ctx.save();
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.translate(shakeX, shakeY);
      this.drawWorld();
      this.drawHud();
      if (this.state !== "playing") this.overlay();
      ctx.restore();
    }

    loop(t) {
      const dt = t - this.last;
      this.last = t;
      if (dt < 100) this.update();
      this.draw();
      requestAnimationFrame((time) => this.loop(time));
    }
  }

  new Game();
})();
