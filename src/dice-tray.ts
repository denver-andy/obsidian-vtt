import { DiceRoll } from 'rpg-dice-roller';

export class DiceTray {
	private readonly el: HTMLElement;
	private formulaInput!: HTMLInputElement;
	private totalEl!: HTMLElement;
	private breakdownEl!: HTMLElement;
	private resultArea!: HTMLElement;
	private lastDie: number | null = null;
	private dieCount = 0;

	constructor(container: HTMLElement) {
		const panel = container.createEl('div', { cls: 'vtt-dice-tray' });
		this.el = panel;

		panel.createEl('div', { text: 'Dice Tray', cls: 'vtt-dice-tray-header' });

		const inputRow = panel.createEl('div', { cls: 'vtt-dice-tray-input-row' });
		this.formulaInput = inputRow.createEl('input', {
			attr: { type: 'text', placeholder: '2d6+4', spellcheck: 'false', autocomplete: 'off' },
			cls: 'vtt-dice-tray-formula-input',
		});
		const rollBtn = inputRow.createEl('button', { text: 'Roll', cls: 'vtt-dice-tray-roll-btn' });

		const diceRow = panel.createEl('div', { cls: 'vtt-dice-tray-dice-row' });
		for (const die of [100, 20, 12, 10, 8, 6, 4]) {
			const btn = diceRow.createEl('button', { text: `d${die}`, cls: 'vtt-dice-tray-die-btn' });
			btn.addEventListener('click', () => {
				if (this.lastDie === die) {
					this.dieCount++;
				} else {
					this.lastDie = die;
					this.dieCount = 1;
				}
				this.formulaInput.value = this.dieCount === 1 ? `d${die}` : `${this.dieCount}d${die}`;
				this.formulaInput.focus();
			});
		}

		this.resultArea = panel.createEl('div', { cls: 'vtt-dice-tray-result' });
		this.totalEl = this.resultArea.createEl('div', { cls: 'vtt-dice-tray-total' });
		this.breakdownEl = this.resultArea.createEl('div', { cls: 'vtt-dice-tray-breakdown' });

		rollBtn.addEventListener('click', () => this.doRoll());
		this.formulaInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') this.doRoll();
		});
	}

	destroy() {
		this.el.remove();
	}

	private doRoll() {
		const formula = this.formulaInput.value.trim();
		if (!formula) return;
		try {
			const roll = new DiceRoll(formula);
			this.totalEl.setText(String(roll.total));
			// Output format: "notation: breakdown = total" — extract just the breakdown
			const output = roll.output;
			const colonIdx = output.indexOf(': ');
			const eqIdx = output.lastIndexOf(' = ');
			const breakdown = colonIdx >= 0 && eqIdx > colonIdx
				? output.substring(colonIdx + 2, eqIdx)
				: output;
			this.breakdownEl.setText(breakdown);
			this.resultArea.addClass('has-result');
		} catch {
			this.totalEl.setText('!');
			this.breakdownEl.setText('Invalid formula');
			this.resultArea.addClass('has-result');
		}
	}
}
