import Phaser from 'phaser';
import './ui/style.css';
import { WorldScene } from './game/scene';
import { refreshStatus } from './agents/gateway';
import { mountHud } from './ui/hud';
import { showTitle } from './ui/screens';
import { ctx, bus } from './core';

async function boot() {
  await refreshStatus();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#1b1c22',
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [WorldScene],
    render: { antialias: true },
  });
  mountHud();
  showTitle();
  // Dev-only handle for debugging and automated smoke tests.
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__sim = { ctx, bus, game };
}

void boot();
