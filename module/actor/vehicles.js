import { yze } from '../YZEDiceRoller.js';

/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
export class ActorSheetAlienRPGVehicle extends ActorSheet {
  constructor(...args) {
    super(...args);

    /**
     * Track the set of item filters which are applied
     * @type {Set}
     */
    this._filters = {
      inventory: new Set(),
      // spellbook: new Set(),
      // features: new Set()
    };
  }

  /** @override */
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ['alienrpg', 'sheet', 'actor', 'vehicles-sheet'],
      // template: 'systems/alienrpg/templates/actor/vehicles-sheet.html',
      width: 600,
      height: 458,
      tabs: [{ navSelector: '.sheet-tabs', contentSelector: '.sheet-body', initial: 'general' }],
    });
  }

  get template() {
    const path = 'systems/alienrpg/templates/actor/';
    return `${path}vehicles-sheet.html`;
  }

  /* -------------------------------------------- */

  /** @override */
  getData() {
    // const data = super.getData();
    // Basic data
    let isOwner = this.entity.owner;
    const data = {
      owner: isOwner,
      limited: this.entity.limited,
      options: this.options,
      editable: this.isEditable,
      cssClass: isOwner ? 'editable' : 'locked',
      isCharacter: this.entity.data.type === 'character',
      isVehicles: this.entity.data.type === 'vehicles',
      isCreature: this.entity.data.type === 'creature',

      config: CONFIG.ALIENRPG,
    };

    // The Actor and its Items
    data.actor = duplicate(this.actor.data);
    data.items = this.actor.items.map((i) => {
      i.data.labels = i.labels;
      return i.data;
    });
    data.items.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    data.data = data.actor.data;
    data.labels = this.actor.labels || {};
    data.filters = this._filters;

    // Return data to the sheet
    this._prepareItems(data); // Return data to the sheet

    return data;
  }

  _findActiveList() {
    return this.element.find('.tab.active .directory-list');
  }
  _filterItems(items, filters) {
    return items.filter((item) => {
      const data = item.data;

      // Action usage
      for (let f of ['action', 'bonus', 'reaction']) {
        if (filters.has(f)) {
          if (data.activation && data.activation.type !== f) return false;
        }
      }

      // Spell-specific filters
      if (filters.has('ritual')) {
        if (data.components.ritual !== true) return false;
      }
      if (filters.has('concentration')) {
        if (data.components.concentration !== true) return false;
      }
      if (filters.has('prepared')) {
        if (data.level === 0 || ['innate', 'always'].includes(data.preparation.mode)) return true;
        if (this.actor.data.type === 'npc') return true;
        return data.preparation.prepared;
      }

      // Equipment-specific filters
      if (filters.has('equipped')) {
        if (data.equipped !== true) return false;
      }
      return true;
    });
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Everything below here is only needed if the sheet is editable
    if (!this.options.editable) return;

    // Add Inventory Item
    html.find('.item-create').click(this._onItemCreate.bind(this));

    // Update Inventory Item
    html.find('.item-edit').click((ev) => {
      const li = $(ev.currentTarget).parents('.item');
      const item = this.actor.getOwnedItem(li.data('itemId'));
      item.sheet.render(true);
    });

    // Delete Inventory Item
    html.find('.item-delete').click((ev) => {
      const li = $(ev.currentTarget).parents('.item');
      this.actor.deleteOwnedItem(li.data('itemId'));
      li.slideUp(200, () => this.render(false));
    });

    // Rollable abilities.
    html.find('.rollable').click(this._onRoll.bind(this));

    html.find('.rollable').contextmenu(this._onRollMod.bind(this));

    // Rollable Items.
    html.find('.rollItem').click(this._rollItem.bind(this));

    html.find('.rollItem').contextmenu(this._onRollItemMod.bind(this));

    // minus from health and stress
    html.find('.minus-btn').click(this._minusButton.bind(this));

    // plus tohealth and stress
    html.find('.plus-btn').click(this._plusButton.bind(this));

    html.find('.click-stat-level').on('click contextmenu', this._onClickStatLevel.bind(this)); // Toggle Dying Wounded

    html.find('.supply-btn').click(this._supplyRoll.bind(this));

    // Roll handlers, click handlers, etc. would go here.
    html.find('.currency').on('change', this._currencyField.bind(this));

    // Drag events for macros.
    if (this.actor.owner) {
      let handler = (ev) => this._onDragItemStart(ev);
      // Find all items on the character sheet.
      html.find('li.item').each((i, li) => {
        // Ignore for the header row.
        if (li.classList.contains('item-header')) return;
        // Add draggable attribute and dragstart listener.
        li.setAttribute('draggable', true);
        li.addEventListener('dragstart', handler, false);
      });
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle creating a new Owned Item for the actor using initial data defined in the HTML dataset
   * @param {Event} event   The originating click event
   * @private
   */
  _onItemCreate(event) {
    event.preventDefault();
    const header = event.currentTarget;
    // Get the type of item to create.
    const type = header.dataset.type;
    // Grab any data associated with this control.
    const data = duplicate(header.dataset);
    // Initialize a default name.
    const name = `New ${type.capitalize()}`;
    // Prepare the item object.
    const itemData = {
      name: name,
      type: type,
      data: data,
    };
    // Remove the type from the dataset since it's in the itemData.type prop.
    delete itemData.data['type'];

    // Finally, create the item!
    return this.actor.createOwnedItem(itemData);
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  _onRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    let label = dataset.label;
    game.alienrpg.rollArr.sCount = 0;

    if (dataset.roll) {
      let r1Data = parseInt(dataset.roll || 0);
      let r2Data = this.actor.getRollData().stress;
      let reRoll = false;
      let hostile = this.actor.type;
      let blind = false;

      if (this.actor.data.token.disposition === -1) {
        blind = true;
      }
      yze.yzeRoll(hostile, blind, reRoll, label, r1Data, 'Black', r2Data, 'Stress');
      game.alienrpg.rollArr.sCount = game.alienrpg.rollArr.r1Six + game.alienrpg.rollArr.r2Six + game.alienrpg.rollArr.r3Six;

      // console.warn('onRoll', game.alienrpg.rollArr);
    } else {
      if (dataset.panicroll) {
        // Roll against the panic table and push the roll to the chat log.
        let chatMessage = '';
        const table = game.tables.getName('Panic Table');
        const roll = new Roll('1d6 + @stress', this.actor.getRollData());
        const customResults = table.roll({ roll });
        chatMessage += '<h2>Panic Condition</h2>';
        chatMessage += `<h4><i>${table.data.description}</i></h4>`;
        chatMessage += `${customResults.results[0].text}`;
        ChatMessage.create({ user: game.user._id, content: chatMessage, other: game.users.entities.filter((u) => u.isGM).map((u) => u._id), type: CONST.CHAT_MESSAGE_TYPES.OTHER });
      }
    }
  }

  _onRollMod(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    let label = dataset.label;
    game.alienrpg.rollArr.sCount = 0;

    let r1Data = parseInt(dataset.roll || 0);
    let r2Data = 0;
    let reRoll = false;
    let hostile = this.actor.type;
    let blind = false;
    if (dataset.spbutt === 'armor' && r1Data < 1) {
      return;
    } else if (dataset.spbutt === 'armor') {
      label = 'Armor';
      r2Data = 0;
    }

    if (this.actor.data.token.disposition === -1) {
      // hostile = true;
      blind = true;
    }

    // callpop upbox here to get any mods then update r1Data or rData as appropriate.
    let confirmed = false;
    new Dialog({
      title: `Roll Modified ${label} check`,
      content: `
       <p>Please enter your modifier.</p>
       <form>
        <div class="form-group">
         <label>Modifier:</label>
           <input type="text" id="modifier" name="modifier" value="0" autofocus="autofocus">
        </div>
       </form>
       `,
      buttons: {
        one: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Roll!',
          callback: () => (confirmed = true),
        },
        two: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel',
          callback: () => (confirmed = false),
        },
      },
      default: 'one',
      close: (html) => {
        if (confirmed) {
          let modifier = parseInt(html.find('[name=modifier]')[0].value);
          r1Data = r1Data + modifier;
          yze.yzeRoll(hostile, blind, reRoll, label, r1Data, 'Black', r2Data, 'Stress');
          game.alienrpg.rollArr.sCount = game.alienrpg.rollArr.r1Six + game.alienrpg.rollArr.r2Six + game.alienrpg.rollArr.r3Six;
        }
      },
    }).render(true);
  }

  _onRollItemMod(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    let label = dataset.label;
    let r1Data = parseInt(dataset.roll || 0);
    let r2Data = this.actor.getRollData().stress;
    let reRoll = false;
    let hostile = this.actor.type;
    let blind = false;

    const itemId = $(event.currentTarget).parents('.item').attr('data-item-id');
    const item = this.actor.getOwnedItem(itemId);
    // console.warn('item', item);
    if (item.type === 'weapon') {
      // Trigger the item roll
      return item.roll(true);
    }
  }

  _minusButton(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    if (dataset.pmbut === 'minusStress') {
      this.actor.update({ 'data.header.stress.value': this.actor.data.data.header.stress.value - 1 });
      // }
    } else {
      this.actor.update({ 'data.header.health.value': this.actor.data.data.header.health.value - 1 });
    }
  }
  _plusButton(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    if (dataset.pmbut === 'plusStress') {
      this.actor.update({ 'data.header.stress.value': this.actor.data.data.header.stress.value + 1 });
    } else {
      this.actor.update({ 'data.header.health.value': this.actor.data.data.header.health.value + 1 });
    }
  }

  _onClickStatLevel(event) {
    event.preventDefault();

    const field = $(event.currentTarget).siblings('input[type="hidden"]');
    const max = field.data('max') == undefined ? 4 : field.data('max');
    const statIsItemType = field.data('stat-type') == undefined ? false : field.data('stat-type'); // Get the current level and the array of levels
    const level = parseFloat(field.val());
    let newLevel = ''; // Toggle next level - forward on click, backwards on right

    if (event.type === 'click') {
      newLevel = Math.clamped(level + 1, 0, max);
    } else if (event.type === 'contextmenu') {
      newLevel = Math.clamped(level - 1, 0, max);
    } // Update the field value and save the form

    field.val(newLevel);

    this._onSubmit(event);
  }

  /**
   * Get the font-awesome icon used to display a certain level of radiation
   * @private
   */

  _getClickIcon(level, stat) {
    const maxPoints = this.object.data.data.general[stat].max;
    const icons = {};
    const usedPoint = '<i class="far fa-dot-circle"></i>';
    const unUsedPoint = '<i class="far fa-circle"></i>';

    for (let i = 0; i <= maxPoints; i++) {
      let iconHtml = '';

      for (let iconColumn = 1; iconColumn <= maxPoints; iconColumn++) {
        iconHtml += iconColumn <= i ? usedPoint : unUsedPoint;
      }

      icons[i] = iconHtml;
    }

    return icons[level];
  }
  _getContitionIcon(level, stat) {
    const maxPoints = this.object.data.data.general[stat].max;
    const icons = {};
    const usedPoint = '<i class="far fa-dot-circle"></i>';
    const unUsedPoint = '<i class="far fa-circle"></i>';

    for (let i = 0; i <= maxPoints; i++) {
      let iconHtml = '';

      for (let iconColumn = 1; iconColumn <= maxPoints; iconColumn++) {
        iconHtml += iconColumn <= i ? usedPoint : unUsedPoint;
      }

      icons[i] = iconHtml;
    }

    return icons[level];
  }

  _supplyRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    const lTemp = 'ALIENRPG.' + dataset.spbutt;
    const label = game.i18n.localize(lTemp) + ' ' + game.i18n.localize('ALIENRPG.Supply');

    // console.warn(element);
    const consUme = dataset.spbutt.toLowerCase();
    let r1Data = 0;
    let r2Data = this.actor.data.data.consumables[consUme].value;
    let reRoll = false;
    let hostile = this.actor.data.type;
    let blind = false;

    if (this.actor.data.token.disposition === -1) {
      blind = true;
    }
    if (r2Data <= 0) {
      return ui.notifications.warn('You have run out of supplies');
    } else {
      yze.yzeRoll(hostile, blind, reRoll, label, r1Data, 'Black', r2Data, 'Stress');
      if (game.alienrpg.rollArr.r2One) {
        switch (consUme) {
          case 'air':
            this.actor.update({ 'data.consumables.air.value': this.actor.data.data.consumables.air.value - game.alienrpg.rollArr.r2One });
            break;
          case 'food':
            this.actor.update({ 'data.consumables.food.value': this.actor.data.data.consumables.food.value - game.alienrpg.rollArr.r2One });
            break;
          case 'power':
            this.actor.update({ 'data.consumables.power.value': this.actor.data.data.consumables.power.value - game.alienrpg.rollArr.r2One });
            break;
          case 'water':
            this.actor.update({ 'data.consumables.water.value': this.actor.data.data.consumables.water.value - game.alienrpg.rollArr.r2One });
            break;
        }
      }
    }
  }

  _rollItem(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    let label = dataset.label;
    const itemName = dataset.item;
    const speaker = ChatMessage.getSpeaker();
    let actor;
    if (speaker.token) actor = game.actors.tokens[speaker.token];

    if (!actor) actor = game.actors.get(speaker.actor);
    const item = actor ? actor.items.find((i) => i.name === itemName) : null;
    if (!item) return ui.notifications.warn(`Your controlled Actor does not have an item named ${itemName}`);
    // console.warn('actor.type', actor.data.type);
    if (actor.data.type === 'vehicles') return ui.notifications.warn(`You do not have a Ranged Combat Skill`);

    // Trigger the item roll
    return item.roll();
  }

  _currencyField(event) {
    event.preventDefault();
    const element = event.currentTarget;

    // console.warn(element.dataset);

    const currency = 'USD'; // https://www.currency-iso.org/dam/downloads/lists/list_one.xml

    // format inital value
    onBlur({ target: event.currentTarget });

    function localStringToNumber(s) {
      return Number(String(s).replace(/[^0-9.-]+/g, ''));
    }

    function onBlur(e) {
      // console.warn('onblur');
      let value = e.target.value;

      let options = {
        maximumFractionDigits: 2,
        currency: currency,
        style: 'currency',
        currencyDisplay: 'symbol',
      };
      e.target.value = value ? localStringToNumber(value).toLocaleString(undefined, options) : '';
      // console.warn(e.target.value);
    }
  }

  _prepareItems(data) {
    // Categorize items as inventory, spellbook, features, and classes
    const inventory = {
      weapon: { label: 'Weapons', items: [], dataset: { type: 'weapon' } },
      item: { label: 'Items', items: [], dataset: { type: 'item' } },
      armor: { label: 'Armor', items: [], dataset: { type: 'armor' } },
    };
    // Partition items by category
    let [items, spells, feats, classes] = data.items.reduce(
      (arr, item) => {
        // Item details
        item.img = item.img || DEFAULT_TOKEN;
        item.isStack = item.data.quantity ? item.data.quantity > 1 : false;

        // console.warn('inventory', inventory);

        // Classify items into types
        if (item.type === 'spell') arr[1].push(item);
        else if (item.type === 'feat') arr[2].push(item);
        else if (item.type === 'class') arr[3].push(item);
        else if (Object.keys(inventory).includes(item.type)) arr[0].push(item);
        return arr;
      },
      [[], [], [], []]
    );

    // Apply active item filters
    items = this._filterItems(items, this._filters.inventory);

    // Organize Inventory
    let totalWeight = 0;
    for (let i of items) {
      //  i.data.quantity = i.data.quantity || 0;
      i.data.attributes.weight.value = i.data.attributes.weight.value || 0;
      i.totalWeight = i.data.attributes.weight.value;
      inventory[i.type].items.push(i);
      totalWeight += i.totalWeight;
    }

    // Assign and return
    data.inventory = Object.values(inventory);
  }
}
export default ActorSheetAlienRPGVehicle;
