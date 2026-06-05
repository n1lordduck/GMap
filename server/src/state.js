export class StateManager {
  constructor() {
    this.currentMap = null;
    this.players    = [];
    this.entities   = [];
  }

  get() {
    return { map: this.currentMap, players: this.players, entities: this.entities };
  }

  updatePlayers(incoming)  { this.players  = incoming; }
  updateEntities(incoming) { this.entities = incoming; }
}
