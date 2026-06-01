import { setIcon } from 'obsidian';
import type { ScreenBounds } from './map-renderer';

const MENU_GAP = 8;

export type ActionMode = 'move' | 'rotate' | 'resize';

export interface AssetActionMenuOptions {
	onLockToggle: () => void;
	onModeChange: (mode: ActionMode) => void;
	onDelete: () => void;
}

export class AssetActionMenu {
	private readonly el: HTMLElement;
	private readonly lockBtn: HTMLElement;
	private readonly moveBtn: HTMLElement;
	private readonly rotateBtn: HTMLElement;
	private readonly resizeBtn: HTMLElement;
	private selectionKey: string | null = null;
	private lastIsLocked: boolean | null = null;

	constructor(container: HTMLElement, options: AssetActionMenuOptions) {
		this.el = container.createEl('div', { cls: 'vtt-asset-menu' });
		this.el.style.display = 'none';

		const makeBtn = (icon: string, title: string): HTMLElement => {
			const btn = this.el.createEl('button', {
				cls: 'vtt-asset-menu-btn',
				attr: { title, 'aria-label': title },
			});
			setIcon(btn, icon);
			btn.addEventListener('mousedown', e => e.preventDefault());
			return btn;
		};

		const modeBtn = (icon: string, title: string, mode: ActionMode): HTMLElement => {
			const btn = makeBtn(icon, title);
			btn.addEventListener('click', () => {
				this.setActiveMode(mode);
				options.onModeChange(mode);
			});
			return btn;
		};

		this.moveBtn   = modeBtn('move',       'Move',   'move');
		this.rotateBtn = modeBtn('rotate-cw',  'Rotate', 'rotate');
		this.resizeBtn = modeBtn('maximize-2', 'Resize', 'resize');
		this.lockBtn   = makeBtn('lock', 'Lock');
		this.lockBtn.addEventListener('click', () => options.onLockToggle());

		const deleteBtn = makeBtn('trash-2', 'Delete');
		deleteBtn.addClass('vtt-asset-menu-btn--danger');
		deleteBtn.addEventListener('click', () => options.onDelete());

		this.setActiveMode('move');
	}

	setActiveMode(mode: ActionMode): void {
		this.moveBtn.toggleClass('is-active',   mode === 'move');
		this.rotateBtn.toggleClass('is-active', mode === 'rotate');
		this.resizeBtn.toggleClass('is-active', mode === 'resize');
	}

	update(bounds: ScreenBounds | null, isLocked: boolean, onModeChange: (mode: ActionMode) => void): void {
		if (!bounds) {
			this.el.style.display = 'none';
			this.selectionKey = null;
			return;
		}

		const isMulti = bounds.isMulti ?? false;
		const key = isMulti ? `multi:${bounds.instanceId}` : bounds.instanceId;
		const isNewSelection = key !== this.selectionKey;
		this.selectionKey = key;

		// Hide resize for multi-select (resize is single-instance only).
		this.resizeBtn.style.display = isMulti ? 'none' : '';

		if (isNewSelection) {
			this.setActiveMode('move');
			onModeChange('move');
		}

		if (isLocked !== this.lastIsLocked) {
			setIcon(this.lockBtn, isLocked ? 'lock' : 'unlock');
			this.lockBtn.setAttribute('title', isLocked ? 'Unlock' : 'Lock');
			this.lockBtn.setAttribute('aria-label', isLocked ? 'Unlock' : 'Lock');
			this.lastIsLocked = isLocked;
		}

		this.el.style.display = '';

		// Read the actual rendered dimensions so we can position precisely.
		// Accessing offsetWidth/offsetHeight forces a synchronous reflow and
		// gives the real values regardless of button styles inherited from Obsidian.
		const menuW = this.el.offsetWidth;
		const menuH = this.el.offsetHeight;

		// Centre horizontally on the asset; show above unless too close to the top.
		const cx = bounds.x + bounds.w / 2;
		const isNearTop = bounds.y < menuH + MENU_GAP * 2;

		this.el.style.left = `${Math.round(cx - menuW / 2)}px`;
		this.el.style.transform = '';

		if (isNearTop) {
			this.el.style.top = `${Math.round(bounds.y + bounds.h + MENU_GAP)}px`;
		} else {
			this.el.style.top = `${Math.round(bounds.y - menuH - MENU_GAP)}px`;
		}
	}

	destroy(): void {
		this.el.remove();
	}
}
