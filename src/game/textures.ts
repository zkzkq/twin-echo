import { Graphics, Sprite, Texture } from 'pixi.js';
import type { Container, Renderer } from 'pixi.js';

/** 程序化生成的纹理集（M1 无美术资产，双色可读性规则 §10.2） */
export interface TEX {
  player: Texture;
  moth: Texture;
  idol: Texture;
  hopper: Texture;
  cultist: Texture;
  eliteRing: Texture;
  boss: Texture;
  needle: Texture;
  bolt: Texture;
  butterfly: Texture;
  ring: Texture;
  /** M3：鼠标准星（专用贴图——复用 ring 缩放后线宽只剩 2px，太淡） */
  reticle: Texture;
  gem: Texture;
  heal: Texture;
  particle: Texture;
  bulletE: Texture;
  altar: Texture;
  trail: Texture;
  tile: Texture;
}

/** 双色世界规则：现实=暖琥珀 / 回响=青蓝（GDD §10.2 S4） */
export const COLORS = {
  player: 0xe8a33d,
  echo: 0x4fd8e0,
  moth: 0xa9b4c8,
  idol: 0x8a6f4d,
  hopper: 0xc96a50,
  cultist: 0xb08968,
  boss: 0xd95f4a,
  eliteRing: 0xffd23e,
  gems: [0x4aa3ff, 0x52e07a, 0xffd23e, 0xffffff],
  rainbow: [0xff5c5c, 0xffb13e, 0xffe74f, 0x52e07a, 0x4fd8e0, 0x9a6bff],
  heal: 0x52e07a,
  bulletE: 0xff6b57,
  bolt: 0xd8f0ff,
  altar: 0xffd77a,
  trail: 0x9fe8f0,
  butterflyBody: 0xffd77a,
  butterflyEcho: 0x7fe8ef,
  needleBody: 0xffd77a,
  needleEcho: 0x7fe8ef,
};

export function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

const WHITE = 0xffffff;

export function makeTextures(renderer: Renderer): TEX {
  const gen = (draw: (g: Graphics) => void, resolution = 2): Texture => {
    const g = new Graphics();
    draw(g);
    const tex = renderer.generateTexture({ target: g, resolution, antialias: true });
    g.destroy();
    return tex;
  };

  // 收割者：圆身 + 朝向三角（本体/残影共用，运行时着色）
  const player = gen((g) => {
    g.circle(0, 0, 12).fill({ color: WHITE });
    g.poly([14, 0, 2, -7, 2, 7]).fill({ color: WHITE });
  });

  // 时蛾：菱形 + 双翼点
  const moth = gen((g) => {
    g.poly([-9, 0, 0, -7, 9, 0, 0, 7]).fill({ color: WHITE });
    g.circle(-3, -4, 2).fill({ color: WHITE });
    g.circle(-3, 4, 2).fill({ color: WHITE });
  });

  // 蚀刻像：墓碑形
  const idol = gen((g) => {
    g.roundRect(-9, -8, 18, 26, 5).fill({ color: WHITE });
    g.circle(0, -8, 7).fill({ color: WHITE });
  });

  // 跳针：箭头剪影
  const hopper = gen((g) => {
    g.poly([14, 0, -6, -9, -1, 0, -6, 9]).fill({ color: WHITE });
  });

  // 膜拜者：兜帽形
  const cultist = gen((g) => {
    g.circle(0, 2, 8).fill({ color: WHITE });
    g.poly([-7, -2, 0, -12, 7, -2]).fill({ color: WHITE });
  });

  const eliteRing = gen((g) => {
    g.circle(0, 0, 24).stroke({ width: 2.5, color: WHITE, alpha: 0.9 });
  });

  // 分针兽：交叉时针 + 轴心
  const boss = gen((g) => {
    g.poly([0, 0, 4, -30, -4, -30]).fill({ color: WHITE });
    g.poly([0, 0, 30, 4, 30, -4]).fill({ color: WHITE });
    g.circle(0, 0, 8).fill({ color: WHITE });
  });

  const needle = gen((g) => {
    g.poly([0, -16, 6, 0, 0, 16, -6, 0]).fill({ color: WHITE });
  });

  const bolt = gen((g) => {
    g.roundRect(-9, -2.5, 18, 5, 2.5).fill({ color: WHITE });
  });

  const butterfly = gen((g) => {
    g.poly([-2, 0, -9, -8, -11, 0, -9, 8]).fill({ color: WHITE });
    g.poly([2, 0, 9, -8, 11, 0, 9, 8]).fill({ color: WHITE });
  });

  const ring = gen((g) => {
    g.circle(0, 0, 40).stroke({ width: 5, color: WHITE, alpha: 0.95 });
  });

  // 鼠标准星（M3）：外圈 + 中心点 + 四向刻度，即使缩到 32px 也读得出来
  const reticle = gen((g) => {
    g.circle(0, 0, 15).stroke({ width: 3, color: WHITE, alpha: 1 });
    g.circle(0, 0, 3).fill({ color: WHITE, alpha: 1 });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      g.moveTo(cx * 17, cy * 17).lineTo(cx * 24, cy * 24).stroke({ width: 3, color: WHITE, alpha: 0.9 });
    }
  });

  const gem = gen((g) => {
    g.poly([0, -8, 7, 0, 0, 8, -7, 0]).fill({ color: WHITE });
  });

  const heal = gen((g) => {
    g.roundRect(-7, -2.5, 14, 5, 2).fill({ color: WHITE });
    g.roundRect(-2.5, -7, 5, 14, 2).fill({ color: WHITE });
  });

  const particle = gen((g) => {
    g.rect(-2, -2, 4, 4).fill({ color: WHITE });
  });

  const bulletE = gen((g) => {
    g.circle(0, 0, 6).fill({ color: WHITE });
  });

  /** 进化祭坛：六边形基座 + 内环（GDD §6.5） */
  const altar = gen((g) => {
    const r = 30;
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 - Math.PI / 6;
      pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.poly(pts).fill({ color: WHITE, alpha: 0.22 });
    g.poly(pts).stroke({ width: 2.5, color: WHITE, alpha: 0.95 });
    g.circle(0, 0, 12).stroke({ width: 2, color: WHITE, alpha: 0.9 });
    g.circle(0, 0, 4).fill({ color: WHITE, alpha: 0.9 });
  });

  /** 残光轨迹段：细长菱形 */
  const trail = gen((g) => {
    g.poly([-7, -3, 7, 0, -7, 3]).fill({ color: WHITE, alpha: 0.8 });
  });

  // 时钟平原背景 tile：暗底 + 微弱网格 + 齿轮刻痕
  const tile = gen((g) => {
    g.rect(0, 0, 256, 256).fill({ color: 0x0d1017 });
    for (let i = 0; i <= 256; i += 32) {
      g.rect(i, 0, 1, 256).fill({ color: 0x131926 });
      g.rect(0, i, 256, 1).fill({ color: 0x131926 });
    }
    g.circle(64, 64, 18).stroke({ width: 1, color: 0xe8a33d, alpha: 0.06 });
    g.circle(64, 64, 6).stroke({ width: 1, color: 0xe8a33d, alpha: 0.05 });
    g.circle(192, 128, 26).stroke({ width: 1, color: 0x4fd8e0, alpha: 0.05 });
    g.circle(192, 128, 10).stroke({ width: 1, color: 0x4fd8e0, alpha: 0.04 });
    g.circle(128, 224, 12).stroke({ width: 1, color: 0xe8a33d, alpha: 0.05 });
    g.circle(30, 190, 4).fill({ color: 0x4fd8e0, alpha: 0.05 });
    g.circle(226, 40, 5).fill({ color: 0xe8a33d, alpha: 0.05 });
  }, 1);

  return {
    player, moth, idol, hopper, cultist, eliteRing, boss,
    needle, bolt, butterfly, ring, reticle, gem, heal, particle, bulletE, altar, trail, tile,
  };
}

/** 便捷：创建居中锚点的隐藏精灵 */
export function hiddenSprite(tex: Texture, parent: Container): Sprite {
  const s = new Sprite(tex);
  s.anchor.set(0.5);
  s.visible = false;
  parent.addChild(s);
  return s;
}
