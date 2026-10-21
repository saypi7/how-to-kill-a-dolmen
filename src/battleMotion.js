// These offsets are presentation only. The server owns every unit's x, hp and target.
const profiles = {
  tank: {step: 0.8, stride: 190, lunge: 5, windup: 1.4, hover: 0, tilt: 0.012},
  assault: {step: 1.6, stride: 145, lunge: 8, windup: 2, hover: 0, tilt: 0.023},
  skirmisher: {step: 2.2, stride: 115, lunge: 7, windup: 1.8, hover: 0, tilt: 0.028},
  flying: {step: 2.6, stride: 240, lunge: 7, windup: 1.6, hover: 30, tilt: 0.025},
};

const profileFor = role => profiles[role] || profiles.assault;
const ease = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * ease(t);

export function unitDirection(unit, units, bases) {
  const fallback = unit.side === 0 ? 1 : -1;
  const target = typeof unit.target === 'string' && unit.target.startsWith('base:')
    ? {x: bases[Number(unit.target.slice(5))]}
    : units.find(other => other.id === unit.target);
  return target && Number.isFinite(target.x) && target.x !== unit.x
    ? Math.sign(target.x - unit.x) : fallback;
}

export function screenDirection(direction, viewerSide) {
  return direction * (viewerSide === 1 ? -1 : 1);
}

export function smoothPosition(current, target, elapsedMs, reducedMotion = false) {
  if (reducedMotion || !Number.isFinite(current)) return target;
  return current + (target - current) * (1 - Math.exp(-20 * Math.max(0, elapsedMs) / 1000));
}

export function attackMotion({attackAt, now, role, direction = 1, interval = 1000, reducedMotion = false}) {
  const rest = {x: 0, y: 0, rotation: 0};
  if (reducedMotion || !Number.isFinite(attackAt) || attackAt <= 0) return rest;
  const duration = Math.min(420, Math.max(220, interval * 0.52));
  const phase = (now - attackAt) / duration;
  if (phase < 0 || phase >= 1) return rest;
  const p = profileFor(role);
  let displacement;
  if (phase < 0.18) displacement = lerp(0, -p.windup, phase / 0.18);
  else if (phase < 0.42) displacement = lerp(-p.windup, p.lunge, (phase - 0.18) / 0.24);
  else displacement = lerp(p.lunge, 0, (phase - 0.42) / 0.58);
  return {x: displacement * direction, y: -Math.sin(Math.PI * phase) * (role === 'flying' ? 1.5 : 0.5), rotation: displacement / p.lunge * p.tilt * direction};
}

export function travelMotion({now, serial = 0, role, moving, reducedMotion = false}) {
  const p = profileFor(role);
  if (reducedMotion) return {y: -p.hover, rotation: 0};
  const wave = Math.sin(now / p.stride + serial * 1.7);
  if (role === 'flying') return {y: -p.hover + wave * p.step, rotation: wave * 0.012};
  return moving ? {y: -Math.abs(wave) * p.step, rotation: wave * p.tilt * 0.45} : {y: 0, rotation: 0};
}

export function hitMotion({hitAt, now, direction = 1, reducedMotion = false}) {
  const phase = (now - hitAt) / 180;
  if (!Number.isFinite(hitAt) || hitAt <= 0 || phase < 0 || phase >= 1) return {x: 0, highlight: false};
  return {x: reducedMotion ? 0 : -direction * Math.sin(phase * Math.PI) * 3, highlight: true};
}

export function fitSprite(imageWidth, imageHeight, maxWidth, maxHeight) {
  if (!(imageWidth > 0 && imageHeight > 0)) return {width: maxWidth, height: maxHeight};
  const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
  return {width: imageWidth * scale, height: imageHeight * scale};
}
