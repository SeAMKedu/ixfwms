/**
 * Every error the server reports on purpose, by key, as English text with {{placeholders}}.
 * The server sends the key and its values with the English message; the web app shows its own
 * translation of the key (`apiErrors.<key>`, Finnish in fi.json), and MCP and scripts read the
 * English message.
 */
export const ERROR_MESSAGES = {
  'input.invalid': 'Invalid input',
  'server.internal': 'Something went wrong on the server',
  'server.sameTime': 'Someone else changed this at the same moment; try again',

  'notFound.move': 'Move not found: {{ref}}',
  'notFound.part': 'Part not found: {{ref}}',
  'notFound.report': 'Report not found: {{ref}}',
  'notFound.location': 'Location not found: {{ref}}',
  'notFound.placeType': 'Place type not found: {{ref}}',
  'notFound.stockLot': 'Stock lot not found: {{ref}}',
  'notFound.category': 'Category not found: {{ref}}',
  'notFound.unit': 'Unit not found: {{ref}}',
  'notFound.file': 'File not found: {{ref}}',
  'notFound.fileContent': 'File content not found: {{ref}}',
  'notFound.map': 'Map not found: {{ref}}',
  'notFound.mapDrawing': 'Map drawing not found: {{ref}}',
  'notFound.user': 'User not found: {{ref}}',

  'auth.unknownToken': 'Unknown or revoked API token',
  'auth.needToken': 'This needs an API token',
  'auth.needScope': 'This needs the "{{scope}}" scope',
  'auth.logInFirst': 'Log in first',
  'auth.notLoggedIn': 'Not logged in',
  'auth.passwordTooShort': 'Passwords need at least {{min}} characters',
  'auth.tooManyLogins': 'Too many failed logins, try again in a few minutes',
  'auth.wrongLogin': 'Wrong name or password',
  'auth.accountOff': 'This account is turned off',
  'auth.wrongPassword': 'The current password is wrong',
  'users.exists': 'User "{{name}}" already exists',
  'users.accountOff': "{{name}}'s account is turned off",
  'users.badScopes': 'Scopes must be some of: {{scopes}}',
  'users.badRole': 'Role must be one of {{roles}}',
  'users.notYourself': "You can't turn off your own account",
  'users.lastAdmin': 'This is the last admin; make someone else an admin first',
  'users.hasLoans':
    '{{name}} is responsible for {{count}} loan(s) out of the lab; return them or lend them again under someone else first',
  'users.isCarrying': '{{name}} is carrying {{count}} thing(s); put them down first',
  'users.cantRemoveSelf': "You can't remove your own account",
  'users.hasHistory': '{{name}} has history; turn the account off instead',

  'open.logInToMove': 'Log in to move things anywhere but a workstation',
  'open.logIn': 'Log in to do this',
  'open.noHome': 'Nobody has said where this belongs; set its home first',
  'open.noOrigin': 'Nobody knows where this came from; move it by hand',
  'open.onlyWorkstations': 'Only workstations can be cleared like this',

  'admin.noCa': 'No local certificate authority is configured (IXF_CA_CERT)',
  'admin.noBackup': 'No backup {{name}}',
  'files.notMultipart': 'Send the file as multipart/form-data in a field named "file"',
  'files.tooLarge': 'File is larger than the upload limit',
  'files.noUpload': 'No uploaded file with id {{id}}',

  'history.movedAgain': '{{name}} has been moved again since; undo that first',
  'history.onlyMoves': 'Only moves can be undone',
  'history.changedSince': 'That stock has changed since; it can no longer be undone',
  'history.absorbed': 'It went back into stock nobody has counted; take it out again by hand',
  'history.cut': "A cut can't be undone; move the piece back by hand",
  'history.takenSince': 'Some of it has been taken since; move it back by hand',

  'parts.mergeSelf': 'A part cannot be merged into itself',
  'parts.hasAmounts':
    '{{name}} has stock amounts; move or remove them before tracking it one by one',
  'parts.hasUnits': "{{name}} has units; it can't be tracked as amounts",
  'bom.tooManyLines': 'Check at most {{max}} lines at a time',
  'import.tooManyRows': 'Import at most {{max}} rows at a time',

  'places.cantCopy': "The {{name}} location can't be copied",
  'places.cantMove': "The {{name}} location can't be moved",
  'places.intoItself': "Can't move {{name}} into itself or into something inside it",
  'places.typeInUse': 'Places of type {{type}} exist; change their type first',
  'places.shortNameTaken': '{{name}} next to it already has the short name {{short}}',
  'places.unknownType': 'Unknown location type "{{key}}". Known types: {{known}}',
  'places.cantCreateInside': "Locations can't be created inside {{name}}",

  'levels.inUse': 'Stock is at {{levels}}; set it to another level before removing it',
  'stock.notWhole': "{{quantity}} isn't a whole number of pieces",
  'stock.unknownLevel': 'Unknown level "{{level}}". Levels: {{levels}}',
  'stock.trackedOneByOne': '{{name}} is tracked one by one; add units instead of an amount',
  'stock.giveLevel': 'This stock is tracked as a level; give the new level',
  'stock.giveTaken': 'Give how much was taken',
  'stock.notEnough': "Only {{amount}} here, can't take {{quantity}}",
  'stock.givePositive': 'Give a positive quantity to move',
  'stock.uncountedPart':
    "Nobody has counted this stock, so part of it can't be moved; move all of it, or count it first",
  'stock.noneLeft': 'This is marked empty; nothing can come out of it',
  'stock.notCutStock': "{{name}} isn't cut stock; set it to be cut by length or as sheets first",
  'stock.wrongShape':
    'Give each piece as a length, or as width × height for sheets, to match the item',
  'stock.noPieceFits': 'No piece here is big enough for {{size}}',
  'stock.cutPieces': 'Say how many pieces to move, or what size to cut',
  'stock.countIt': 'A stocktake says how much there is; give the amount',
  'stock.noLot': 'No stock lot {{id}}',
  'stock.pickUpToCarry': 'Pick it up to carry it',

  'codes.notValid': '"{{code}}" is not a valid code',
  'codes.inUse.location': 'Code {{code}} is already used by a location',
  'codes.inUse.part': 'Code {{code}} is already used by a part',
  'codes.inUse.unit': 'Code {{code}} is already used by a unit',
  'codes.retired': 'Code {{code}} was retired; throw that label away and use another',
  'codes.taken': 'That code is already in use or retired; pick another',
  'labels.blankCount': 'Ask for 1 to {{max}} blank labels',
  'labels.changeInstead.location': "{{code}} is on a location; change that location's code instead",
  'labels.changeInstead.part': "{{code}} is on a part; change that part's code instead",
  'labels.changeInstead.unit': "{{code}} is on a unit; change that unit's code instead",
  'labels.noPart': 'No part {{ref}}',
  'labels.noUnit': 'No unit {{ref}}',
  'labels.twoPlaces': 'Pick two different places',

  'categories.emptyPath': 'Category path is empty',
  'categories.keyTwice': 'Field key "{{key}}" is used twice',
  'categories.giveName': 'Give the new name or path',
  'categories.insideItself': 'A category cannot go inside itself',
  'categories.exists': 'There already is a category {{path}}',
  'categories.hasChildren': '{{path}} has sub-categories; move or delete them first',
  'categories.whereParts': '{{path}} has {{count}} part(s); say which category they go to',
  'categories.pickAnother': 'Pick another category for its parts',

  'units.giveVersion': 'Give the firmware or software version now installed',
  'units.writeSomething': 'Write what was done or noticed',
  'units.lentReturnFirst': 'This is lent out of the lab; return it first',
  'units.alreadyLent': 'This is already lent out',
  'units.noResponsible':
    'No user "{{name}}"; the person responsible needs an account (a teacher, say)',
  'units.notLent': "This isn't lent out",
  'units.notLost': "This isn't marked lost",
  'units.lendInstead': 'Lend it out instead of moving it out of the lab',
  'loans.placeLent': '{{name}} is lent out of the lab; return it first',
  'loans.containersOnly':
    "Only containers (a box, case or pallet) can be lent out; lend what's in {{name}} one by one",
  'loans.notInside': '{{unit}} is not in {{name}}',
  'delete.inBuild': '{{name}} is built into something; take it out first',
  'delete.unitLent': '{{unit}} of {{name}} is lent out; return it or mark it lost first',
  'delete.lent': '{{name}} is lent out; return it or mark it lost first',
  'delete.notEmpty': "{{name}} isn't empty; move what's in it first",
  'delete.homeOf': '{{count}} unit(s) belong at {{name}}; give them another home first',
  'places.cantDelete': "The {{name}} place can't be deleted",
  'builds.dismantled': '{{name}} has been dismantled; nothing can go in it',
  'places.archived': '{{name}} is archived; unarchive it first',
  'places.cantArchive': "{{name}} can't be archived; only movable containers can",
  'places.notArchived': "{{name}} isn't archived",
  'builds.notBuild': "{{name}} isn't a build",
  'builds.alreadyDismantled': '{{name}} is already dismantled',
  'builds.outside': 'Pick a place outside {{name}} to put its parts on',
  'carry.pickWhat': 'Pick a place, a stock lot or a unit',
  'carry.nothing': 'Nothing to put down',
  'carry.realPlace': 'Pick a real place to put things down',

  'maps.uploadSvg': 'This map is an SVG drawing; upload an .svg',
  'maps.uploadGlb': 'This map is a 3D model; upload a .glb',
  'maps.stillUsed': 'Still used by {{count}} place(s); remove it from them first',
  'maps.notInside': "{{target}} isn't inside {{place}}",
  'maps.bothNeedMap': 'Both places need a map first',
  'maps.differentDrawing': '{{name}} uses a different drawing',
  'maps.svgTooLarge': 'That drawing is too large for a map (max 10 MB)',
  'maps.glbTooLarge': 'That model is too large for a map (max 100 MB)',
  'maps.wrongFormat': 'Maps are SVG drawings (.svg) or binary glTF models (.glb)',
} as const;

export type ErrorKey = keyof typeof ERROR_MESSAGES;
export type ErrorParams = Record<string, string | number>;

/** The English message for `key`, with its {{placeholders}} filled in. */
export function errorMessage(key: ErrorKey, params: ErrorParams = {}): string {
  return ERROR_MESSAGES[key].replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(params[name] ?? `{{${name}}}`),
  );
}

type Tree = { [key: string]: string | Tree };

/** The messages as a nested tree ("stock.notWhole" → { stock: { notWhole } }), the shape i18next reads. */
export function errorMessageTree(): Tree {
  const tree: Tree = {};
  for (const [key, text] of Object.entries(ERROR_MESSAGES)) {
    const parts = key.split('.');
    let node = tree;
    for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Tree;
    node[parts.at(-1)!] = text;
  }
  return tree;
}
