// Snake.js – håller all logik och färginställning för en orm

export class Snake {
	constructor(startX, startY, options = {}) {
		// Bestäm startdirection (om ingen ges: gå höger)
		const dir = options.startDirection ?? { x: 1, y: 0 };

		// Segment är grid-koordinater { x, y }
		// Starta alltid med två segment i motsatt riktning mot rörelsen
		this.segments = [
			{ x: startX, y: startY },
			{
				x: startX - dir.x,
				y: startY - dir.y
			}
		];

		// initial riktning
		this.direction = { ...dir };
		this.nextDirection = { ...dir };

		// Färger & stil – bra inför multiplayer
		this.colorHead = options.colorHead ?? "#d783ff";
		this.colorHeadStroke = options.colorHeadStroke ?? "#b300ff";
		this.colorBody = options.colorBody ?? "#4dff4d";
		this.tailScale = options.tailScale ?? 0.6; // hur liten svanstippen är
	}

	setDirection(dx, dy) {
		// Förhindra 180-graders vändning (rakt in i sig själv)
		if (dx === -this.direction.x && dy === -this.direction.y) {
			return;
		}
		this.nextDirection = { x: dx, y: dy };
	}

	step() {
		// Uppdatera riktning först
		this.direction = this.nextDirection;

		const head = this.segments[0];
		const newHead = {
			x: head.x + this.direction.x,
			y: head.y + this.direction.y
		};

		// Lägg till nytt huvud först...
		this.segments.unshift(newHead);
		// ...och ta bort sista segmentet (om vi inte växer)
		this.segments.pop();
	}

	grow() {
		// Lägg till ett segment i slutet genom att duplicera sista segmentet
		const tail = this.segments[this.segments.length - 1];
		this.segments.push({ x: tail.x, y: tail.y });
	}
}
