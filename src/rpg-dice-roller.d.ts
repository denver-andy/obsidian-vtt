declare module 'rpg-dice-roller' {
	class DiceRoll {
		constructor(notation: string);
		readonly total: number;
		readonly output: string;
		readonly notation: string;
	}
	export { DiceRoll };
}
