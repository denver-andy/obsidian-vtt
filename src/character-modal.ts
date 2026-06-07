import { App, DataAdapter, Modal, setIcon, TFile } from 'obsidian';
import { AssetPicker, AssetFile } from './asset-picker';

export type VttCharacterType = 'pc' | 'npc' | 'beast';

interface TypeConfig {
	label: string;
	tag: string;
	icon: string;
}

export const CHARACTER_TYPE_CONFIGS: Record<VttCharacterType, TypeConfig> = {
	pc:    { label: 'Player Character', tag: 'vtt/pc',    icon: 'users' },
	npc:   { label: 'NPC',              tag: 'vtt/npc',   icon: 'user' },
	beast: { label: 'Beast',            tag: 'vtt/beast', icon: 'paw-print' },
};

export interface CharacterModalOptions {
	pluginDir: string;
	adapter: DataAdapter;
	customTokensFolder: string;
}

export class CharacterModal extends Modal {
	private readonly file: TFile;
	private readonly type: VttCharacterType;
	private readonly opts: CharacterModalOptions;

	private nameInput!: HTMLInputElement;
	private selectedToken: AssetFile | null = null;
	private selectedDisplayEl!: HTMLElement;
	private picker!: AssetPicker;

	constructor(app: App, file: TFile, type: VttCharacterType, opts: CharacterModalOptions) {
		super(app);
		this.file = file;
		this.type = type;
		this.opts = opts;
	}

	onOpen() {
		const config = CHARACTER_TYPE_CONFIGS[this.type];
		this.modalEl.addClass('vtt-character-modal');
		this.setTitle(`Set up as ${config.label}`);

		const { contentEl } = this;

		// ── Name ─────────────────────────────────────────────────────────────
		const nameSection = contentEl.createEl('div', { cls: 'vtt-cmodal-section' });
		nameSection.createEl('label', { text: 'Name', cls: 'vtt-cmodal-label' });
		this.nameInput = nameSection.createEl('input', {
			cls: 'vtt-cmodal-input',
			attr: { type: 'text', value: this.file.basename, spellcheck: 'false' },
		}) as HTMLInputElement;
		this.nameInput.select();

		// ── Token ─────────────────────────────────────────────────────────────
		const tokenSection = contentEl.createEl('div', { cls: 'vtt-cmodal-section' });
		tokenSection.createEl('label', { text: 'Token', cls: 'vtt-cmodal-label' });

		// Shared search bar for the picker below
		const searchWrap = tokenSection.createEl('div', { cls: 'vtt-browser-search vtt-cmodal-search' });
		const searchEl = searchWrap.createEl('input', {
			cls: 'vtt-browser-search-input',
			attr: { type: 'text', placeholder: 'Filter tokens…', spellcheck: 'false' },
		}) as HTMLInputElement;
		const clearBtn = searchWrap.createEl('button', {
			cls: 'vtt-browser-search-clear',
			attr: { 'aria-label': 'Clear filter' },
			text: '×',
		});
		clearBtn.addEventListener('mousedown', e => e.preventDefault());
		clearBtn.addEventListener('click', () => {
			searchEl.value = '';
			this.picker.setFilter('');
		});
		searchEl.addEventListener('input', () => {
			this.picker.setFilter(searchEl.value.trim().toLowerCase());
		});

		// Asset picker (select mode, tokens only)
		const pickerWrap = tokenSection.createEl('div', { cls: 'vtt-cmodal-picker' });
		this.picker = new AssetPicker(pickerWrap, {
			adapter: this.opts.adapter,
			pluginDir: this.opts.pluginDir,
			category: 'tokens',
			customFolder: this.opts.customTokensFolder,
			mode: 'select',
			onSelect: (file) => {
				this.selectedToken = file;
				this.renderSelectedDisplay();
			},
		});
		this.picker.el.style.display = '';

		// Selected token preview
		this.selectedDisplayEl = tokenSection.createEl('div', { cls: 'vtt-cmodal-selection' });
		this.renderSelectedDisplay();

		// ── Buttons ───────────────────────────────────────────────────────────
		const btnRow = contentEl.createEl('div', { cls: 'vtt-cmodal-btn-row' });
		const cancelBtn = btnRow.createEl('button', { text: 'Cancel', cls: 'vtt-cmodal-btn' });
		const applyBtn = btnRow.createEl('button', { text: 'Apply', cls: 'vtt-cmodal-btn vtt-cmodal-btn--primary' });

		const typeIcon = applyBtn.createSpan({ cls: 'vtt-cmodal-btn-icon' });
		setIcon(typeIcon, config.icon);
		applyBtn.prepend(typeIcon);

		cancelBtn.addEventListener('click', () => this.close());
		applyBtn.addEventListener('click', () => { void this.apply(); });

		// Allow Enter to submit
		this.modalEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && e.target !== searchEl) {
				e.preventDefault();
				void this.apply();
			}
		});
	}

	onClose() {
		this.picker?.destroy();
		this.contentEl.empty();
	}

	private renderSelectedDisplay() {
		const el = this.selectedDisplayEl;
		el.empty();

		if (!this.selectedToken) {
			el.createEl('span', { cls: 'vtt-cmodal-no-selection', text: 'No token selected' });
			return;
		}

		const src = this.opts.adapter.getResourcePath(this.selectedToken.path);
		const img = el.createEl('img', {
			cls: 'vtt-cmodal-selection-img',
			attr: { alt: this.selectedToken.name },
		});
		img.src = src;
		el.createEl('span', { cls: 'vtt-cmodal-selection-path', text: this.selectedToken.path });
	}

	private async apply() {
		const config = CHARACTER_TYPE_CONFIGS[this.type];
		const name = this.nameInput.value.trim() || this.file.basename;
		const tokenPath = this.selectedToken?.path ?? null;

		await this.app.fileManager.processFrontMatter(this.file, (fm) => {
			// Normalize existing tags to an array, strip old vtt/* tags, add the new one.
			let tags: string[] = [];
			if (Array.isArray(fm['tags'])) tags = fm['tags'] as string[];
			else if (typeof fm['tags'] === 'string') tags = [fm['tags']];

			tags = tags.filter((t: string) => !t.startsWith('vtt/'));
			tags.push(config.tag);
			fm['tags'] = tags;

			// Only write vtt-name if it differs from the note title (avoids redundant frontmatter).
			if (name !== this.file.basename) fm['vtt-name'] = name;
			else delete fm['vtt-name'];

			if (tokenPath) fm['vtt-token'] = tokenPath;
			else delete fm['vtt-token'];
		});

		this.close();
	}
}
