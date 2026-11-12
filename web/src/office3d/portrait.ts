// Head-and-shoulders portrait matching a character's 3D look, for the dashboard.

import type { Look } from './look.ts';

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

export function drawPortrait(canvas: HTMLCanvasElement, look: Look, size: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr * (size / 100), 0, 0, dpr * (size / 100), 0, 0);
  ctx.clearRect(0, 0, 100, 100);

  // Background.
  const bg = ctx.createLinearGradient(0, 0, 0, 100);
  bg.addColorStop(0, '#3a3150');
  bg.addColorStop(1, '#251f33');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, 100, 100, 18);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, 100, 100, 18);
  ctx.clip();

  const ink = '#17131f';
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = ink;
  const w = look.build;

  // Shoulders and top.
  ctx.fillStyle = look.shirt;
  ctx.beginPath();
  ctx.moveTo(50 - 34 * w, 104);
  ctx.bezierCurveTo(50 - 36 * w, 80, 50 - 26 * w, 72, 50, 71);
  ctx.bezierCurveTo(50 + 26 * w, 72, 50 + 36 * w, 80, 50 + 34 * w, 104);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (look.top === 'hoodie') {
    ctx.fillStyle = shade(look.shirt, -0.15);
    ctx.beginPath();
    ctx.ellipse(50, 74, 18, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (look.top === 'shirt') {
    ctx.fillStyle = shade(look.shirt, 0.55);
    ctx.beginPath();
    ctx.moveTo(42, 72);
    ctx.lineTo(50, 82);
    ctx.lineTo(58, 72);
    ctx.closePath();
    ctx.fill();
  }
  if (look.badge) {
    ctx.strokeStyle = '#f2f0ea';
    ctx.beginPath();
    ctx.moveTo(44, 73);
    ctx.lineTo(50, 90);
    ctx.lineTo(56, 73);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(46, 89, 8, 9);
    ctx.strokeStyle = ink;
  }

  // Neck and head.
  ctx.fillStyle = shade(look.skin, -0.12);
  ctx.fillRect(43, 60, 14, 14);
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.ellipse(32, 46, 4, 6, 0, 0, Math.PI * 2);
  ctx.ellipse(68, 46, 4, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(50, 44, 18, 23, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Beard.
  if (look.beard === 'full' || look.beard === 'stubble') {
    ctx.fillStyle = look.beard === 'full' ? look.hair : shade(look.hair, 0.45);
    ctx.globalAlpha = look.beard === 'full' ? 1 : 0.55;
    ctx.beginPath();
    ctx.ellipse(50, 52, 17.5, 15, 0, 0.05 * Math.PI, 0.95 * Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (look.beard === 'goatee') {
    ctx.fillStyle = look.hair;
    ctx.beginPath();
    ctx.ellipse(50, 64, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (look.beard === 'goatee' || look.beard === 'mustache' || look.beard === 'full') {
    ctx.fillStyle = look.hair;
    ctx.beginPath();
    ctx.ellipse(50, 54, 8, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Face.
  ctx.fillStyle = '#ffffff';
  for (const x of [43, 57]) {
    ctx.beginPath();
    ctx.ellipse(x, 42, 3.6, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#221a14';
  for (const x of [43.4, 57.4]) {
    ctx.beginPath();
    ctx.arc(x, 42.3, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = look.hair;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(39, 37);
  ctx.lineTo(47, 36);
  ctx.moveTo(53, 36);
  ctx.lineTo(61, 37);
  ctx.stroke();
  ctx.strokeStyle = shade(look.skin, -0.3);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(50, 44);
  ctx.quadraticCurveTo(52, 49, 49, 50);
  ctx.stroke();
  if (look.beard !== 'full') {
    ctx.strokeStyle = '#9c4d42';
    ctx.beginPath();
    ctx.moveTo(45, 57);
    ctx.quadraticCurveTo(50, 60, 55, 57);
    ctx.stroke();
  }
  if (look.glasses) {
    ctx.strokeStyle = '#1c1c22';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(43, 42, 5.5, 0, Math.PI * 2);
    ctx.moveTo(62.5, 42);
    ctx.arc(57, 42, 5.5, 0, Math.PI * 2);
    ctx.moveTo(48.5, 42);
    ctx.lineTo(51.5, 42);
    ctx.stroke();
  }

  // Hair or cap.
  ctx.fillStyle = look.cap ? shade(look.shirt, -0.3) : look.hair;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  if (look.cap) {
    ctx.beginPath();
    ctx.ellipse(50, 30, 19, 13, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(40, 28, 26, 4);
  } else if (look.hairStyle !== 'bald') {
    const buzz = look.hairStyle === 'buzz';
    if (buzz) ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.ellipse(50, 33, 19, 14, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.quadraticCurveTo(66, 31, 68, 40);
    ctx.lineTo(66, 36);
    ctx.quadraticCurveTo(52, 26, 34, 36);
    ctx.lineTo(32, 40);
    ctx.quadraticCurveTo(33, 31, 31, 33);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    if (look.hairStyle === 'quiff' || look.hairStyle === 'side') {
      ctx.beginPath();
      ctx.ellipse(look.hairStyle === 'side' ? 56 : 50, 22, 12, 6, look.hairStyle === 'side' ? 0.3 : 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (look.hairStyle === 'curly') {
      for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.arc(34 + i * 4, 25 + Math.sin(i) * 2, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (look.hairStyle === 'long') {
      ctx.fillRect(31, 34, 5, 24);
      ctx.fillRect(64, 34, 5, 24);
    }
    if (look.hairStyle === 'bun') {
      ctx.beginPath();
      ctx.arc(50, 16, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = look.hair;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(31, 40, 4, 8);
    ctx.fillRect(65, 40, 4, 8);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
