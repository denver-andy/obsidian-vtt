import { App, getAllTags, setIcon, TFile } from 'obsidian';
import { CHARACTER_TYPE_CONFIGS, VttCharacterType } from './character-modal';

const TABS: { type: VttCharacterType; label: string }[] = [
	{ type: 'pc',    label: 'PCs' },
	{ type: 'npc',   label: 'NPCs' },
	{ type: 'beast', label: 'Beasts' },
];

interface ActorData {
	name: string;
	tokenPath: string | null;
	notePath: string;
	type: VttCharacterType;
	inlineFields: Record<string, unknown> | null;
}

interface DataviewApi {
	page(path: string): Record<string, unknown> | null | undefined;
}

export interface ActorsPanelOptions {
	app: App;
	getResourcePath: (path: string) => string;
}

export class ActorsPanel {
	private readonly el: HTMLElement;
	private readonly listEl: HTMLElement;
	private readonly searchEl: HTMLInputElement;
	private readonly options: ActorsPanelOptions;

	private activeTab: VttCharacterType = 'pc';
	private filterText = '';
	private refreshTimer: number | null = null;

	constructor(container: HTMLElement, options: ActorsPanelOptions) {
		this.options = options;

		this.el = container.createEl('div', { cls: 'vtt-actors-panel' });

		this.el.createEl('div', { cls: 'vtt-hierarchy-header', text: 'Actors' });

		// ── Header (tabs + refresh) ──────────────────────────────────────────
		const header = this.el.createEl('div', { cls: 'vtt-actors-header' });

		const tabStrip = header.createEl('div', { cls: 'vtt-actors-tabs' });
		for (const tab of TABS) {
			const btn = tabStrip.createEl('button', {
				cls: 'vtt-actors-tab' + (tab.type === this.activeTab ? ' is-active' : ''),
				text: tab.label,
				attr: { 'aria-label': tab.label },
			});
			btn.addEventListener('mousedown', e => e.preventDefault());
			btn.addEventListener('click', () => {
				this.activeTab = tab.type;
				for (const b of Array.from(tabStrip.querySelectorAll('.vtt-actors-tab'))) {
					b.toggleClass('is-active', b === btn);
				}
				this.render();
			});
		}

		const refreshBtn = header.createEl('button', {
			cls: 'vtt-actors-header-btn',
			attr: { 'aria-label': 'Refresh' },
		});
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.addEventListener('mousedown', e => e.preventDefault());
		refreshBtn.addEventListener('click', () => this.render());

		// ── Search ───────────────────────────────────────────────────────────
		const searchWrap = this.el.createEl('div', { cls: 'vtt-actors-search' });
		this.searchEl = searchWrap.createEl('input', {
			cls: 'vtt-actors-search-input',
			attr: { type: 'text', placeholder: 'Filter…', spellcheck: 'false' },
		}) as HTMLInputElement;
		this.searchEl.addEventListener('input', () => {
			this.filterText = this.searchEl.value.trim().toLowerCase();
			this.render();
		});
		const clearBtn = searchWrap.createEl('button', {
			cls: 'vtt-actors-search-clear',
			attr: { 'aria-label': 'Clear filter' },
			text: '×',
		});
		clearBtn.addEventListener('mousedown', e => e.preventDefault());
		clearBtn.addEventListener('click', () => {
			this.searchEl.value = '';
			this.filterText = '';
			this.render();
		});

		// ── Actor list ───────────────────────────────────────────────────────
		this.listEl = this.el.createEl('div', { cls: 'vtt-actors-list' });

		options.app.metadataCache.on('changed', this.onCacheChanged);
		options.app.vault.on('rename', this.scheduleRefresh);
		options.app.vault.on('delete', this.scheduleRefresh);
	}

	private readonly onCacheChanged = () => { this.scheduleRefresh(); };
	private readonly scheduleRefresh = () => {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			if (this.el.hasClass('is-open')) this.render();
		}, 300);
	};

	show() { this.el.addClass('is-open'); this.render(); }
	hide() { this.el.removeClass('is-open'); }
	toggle() { if (this.el.hasClass('is-open')) this.hide(); else this.show(); }

	destroy() {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.options.app.metadataCache.off('changed', this.onCacheChanged);
		this.options.app.vault.off('rename', this.scheduleRefresh);
		this.options.app.vault.off('delete', this.scheduleRefresh);
		this.el.remove();
	}

	private getDataviewApi(): DataviewApi | null {
		const plugins = (this.options.app as unknown as {
			plugins?: { plugins?: Record<string, { api?: unknown }> };
		}).plugins?.plugins;
		return (plugins?.['dataview']?.api as DataviewApi) ?? null;
	}

	private getActors(type: VttCharacterType): ActorData[] {
		const { app } = this.options;
		const tag = '#' + CHARACTER_TYPE_CONFIGS[type].tag;
		const dv = this.getDataviewApi();

		return app.vault.getMarkdownFiles()
			.filter(file => {
				const cache = app.metadataCache.getFileCache(file);
				return cache ? (getAllTags(cache) ?? []).includes(tag) : false;
			})
			.map(file => {
				const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};

				let inlineFields: Record<string, unknown> | null = null;
				if (dv) {
					const page = dv.page(file.path);
					if (page) {
						const filtered: Record<string, unknown> = {};
						for (const [k, v] of Object.entries(page)) {
							if (k === 'file' || k === 'tags' || k === 'aliases' || k.startsWith('vtt-')) continue;
							filtered[k] = v;
						}
						if (Object.keys(filtered).length > 0) inlineFields = filtered;
					}
				}

				return {
					name: (fm['vtt-name'] as string | undefined) ?? file.basename,
					tokenPath: (fm['vtt-token'] as string | undefined) ?? null,
					notePath: file.path,
					type,
					inlineFields,
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	private render() {
		const { listEl, options } = this;
		listEl.empty();

		const all = this.getActors(this.activeTab);
		const actors = this.filterText
			? all.filter(c => c.name.toLowerCase().includes(this.filterText))
			: all;

		const dvAvailable = this.getDataviewApi() !== null;
		const config = CHARACTER_TYPE_CONFIGS[this.activeTab];

		if (actors.length === 0) {
			listEl.createEl('div', { cls: 'vtt-actors-empty',
				text: all.length === 0
					? `No ${config.label}s found.`
					: 'No matches.' });
			if (all.length === 0) {
				listEl.createEl('div', { cls: 'vtt-actors-empty-hint',
					text: `Tag a note with ${config.tag} to add one.` });
			}
		}

		for (const actor of actors) {
			const card = listEl.createEl('div', { cls: 'vtt-actors-card' });
			const canDrag = !!actor.tokenPath;
			if (canDrag) {
				card.setAttribute('draggable', 'true');
				card.addClass('vtt-actors-card--draggable');
			}

			const top = card.createEl('div', { cls: 'vtt-actors-card-top' });

			// Token thumbnail
			const thumb = top.createEl('div', { cls: 'vtt-actors-token' });
			if (actor.tokenPath) {
				const img = thumb.createEl('img', {
					cls: 'vtt-actors-token-img',
					attr: { alt: actor.name },
				});
				img.src = options.getResourcePath(actor.tokenPath);
			} else {
				setIcon(thumb, config.icon);
			}

			const info = top.createEl('div', { cls: 'vtt-actors-info' });
			info.createEl('div', { cls: 'vtt-actors-name', text: actor.name });

			const openBtn = top.createEl('button', {
				cls: 'vtt-actors-open-btn',
				attr: { 'aria-label': `Open note for ${actor.name}` },
			});
			setIcon(openBtn, 'external-link');
			openBtn.addEventListener('mousedown', e => e.preventDefault());
			openBtn.addEventListener('click', () => {
				const file = options.app.vault.getAbstractFileByPath(actor.notePath);
				if (file instanceof TFile) {
					void options.app.workspace.getLeaf(false).openFile(file);
				}
			});

			// Inline fields (Dataview-gated)
			if (actor.inlineFields) {
				const fields = card.createEl('div', { cls: 'vtt-actors-fields' });
				for (const [key, val] of Object.entries(actor.inlineFields)) {
					const row = fields.createEl('div', { cls: 'vtt-actors-field-row' });
					row.createEl('span', { cls: 'vtt-actors-field-key', text: key });
					row.createEl('span', { cls: 'vtt-actors-field-val', text: String(val) });
				}
			}

			// Drag — carries actor data for the actors layer
			if (canDrag && actor.tokenPath) {
				const tokenPath = actor.tokenPath;
				card.addEventListener('dragstart', e => {
					if (!e.dataTransfer) return;
					e.dataTransfer.effectAllowed = 'copy';
					e.dataTransfer.setData('application/vtt-actor', JSON.stringify({
						assetPath:     tokenPath,
						resourceUrl:   options.getResourcePath(tokenPath),
						category:      'actors',
						actorNotePath: actor.notePath,
						actorType:     actor.type,
						actorName:     actor.name,
					}));
				});
			}
		}

		if (!dvAvailable) {
			listEl.createEl('div', {
				cls: 'vtt-actors-dv-notice',
				text: 'Install Dataview to show character attributes from notes.',
			});
		}
	}
}
