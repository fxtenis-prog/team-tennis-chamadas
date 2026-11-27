const officialWorkbookId = '1iu3eI_QXNttzb1E5BUirQPOX_3Vn7suc';
const driveReadScope = 'https://www.googleapis.com/auth/drive.readonly';

function normalizeRosterName(value) {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

function rosterHour(value) {
  const text = String(value ?? '').trim();
  const clock = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(text);
  if (clock && Number(clock[1]) < 24 && Number(clock[2]) < 60) {
    return clock[1].padStart(2, '0') + ':' + clock[2];
  }
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440);
    if (minutes < 1440) {
      return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
    }
  }
  return '';
}

async function readOfficialRoster(buffer, who, date = new Date()) {
  const zip = await JSZip.loadAsync(buffer);
  async function xml(path, optional = false) {
    const file = zip.file(path);
    if (!file && optional) return null;
    if (!file) throw Error('A planilha oficial está incompleta.');
    const doc = new DOMParser().parseFromString(await file.async('string'), 'application/xml');
    if (doc.querySelector('parsererror')) throw Error('Não foi possível ler a planilha oficial.');
    return doc;
  }
  const [book, relationships, strings] = await Promise.all([
    xml('xl/workbook.xml'), xml('xl/_rels/workbook.xml.rels'), xml('xl/sharedStrings.xml', true)
  ]);
  const values = strings ? Array.from(strings.getElementsByTagName('si'), richText) : [];
  function richText(cell) {
    return Array.from(cell.getElementsByTagName('t'), text => text.textContent).join('');
  }
  const tabs = Array.from(book.getElementsByTagName('sheet'));
  const month = new Intl.DateTimeFormat('pt-BR', {
    month: 'long', timeZone: 'America/Sao_Paulo'
  }).format(date);
  const months = /^(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) /;
  const candidates = tabs.filter(tab => {
    const name = normalizeRosterName(tab.getAttribute('name'));
    return months.test(name) && name.split(' ').at(-1) === normalizeRosterName(who);
  });
  const sheet = candidates.find(tab => normalizeRosterName(tab.getAttribute('name')) === month + ' ' + normalizeRosterName(who))
    ?? (candidates.length === 1 ? candidates[0] : null);
  if (!sheet) throw Error('Não encontrei a aba de turmas de ' + who + ' para ' + month + '.');
  const relationship = Array.from(relationships.getElementsByTagName('Relationship')).find(item =>
    item.getAttribute('Id') === sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
  if (!relationship || relationship.getAttribute('TargetMode') === 'External') throw Error('A aba de turmas não está disponível.');
  const path = new URL(relationship.getAttribute('Target'), 'https://planilha.invalid/xl/workbook.xml');
  if (path.origin !== 'https://planilha.invalid' || !path.pathname.startsWith('/xl/worksheets/')) {
    throw Error('A aba de turmas está em um formato inesperado.');
  }
  const model = await xml(path.pathname.slice(1));
  const data = Array.from(model.getElementsByTagName('row'), row => {
    const cells = new Map();
    for (const cell of row.getElementsByTagName('c')) {
      const column = /^[A-Z]+/.exec(cell.getAttribute('r'))?.[0];
      if (!column) continue;
      const type = cell.getAttribute('t');
      const value = cell.getElementsByTagName('v')[0]?.textContent;
      if (type === 's') cells.set(column, values[Number(value)]);
      else if (type === 'inlineStr') cells.set(column, richText(cell));
      else if (value !== undefined) cells.set(column, (!type || type === 'n') ? Number(value) : value);
    }
    return cells;
  });
  const columns = [['A','B'], ['E','F'], ['I','J'], ['M','N'], ['Q','R'], ['U','V'], ['Y','Z']];
  const entries = [];
  for (const [index, [nameColumn, valueColumn]] of columns.entries()) {
    const dia = days[index];
    if (normalizeRosterName(String(data[0]?.get(nameColumn) ?? '')) !== normalizeRosterName(dia)) {
      throw Error('O cabeçalho da aba de turmas está em um formato inesperado.');
    }
    let hora = '', local = '';
    for (const cells of data.slice(1)) {
      const name = cells.get(nameColumn);
      const value = cells.get(valueColumn);
      const time = rosterHour(name);
      if (time && typeof value === 'string' && value.trim()) {
        hora = time;
        local = value.trim();
      } else if (hora && typeof name === 'string' && name.trim() && (
        (typeof value === 'number' && Number.isFinite(value)) ||
        /^(?:R\$\s*)?\d+(?:\.\d{3})*(?:,\d{2})?$/.test(String(value ?? '').trim())
      )) {
        entries.push({nome: name.trim(), dia, hora, local});
      }
    }
  }
  if (!entries.length) throw Error('Nenhum aluno ativo encontrado na planilha oficial.');
  return entries;
}

function reconcileOfficialRoster(current, entries, who) {
  const key = student => JSON.stringify([normalizeRosterName(student.nome), student.dia, rosterHour(student.hora)]);
  const byKey = new Map();
  for (const student of current) {
    const id = key(student);
    if (!byKey.has(id) || (byKey.get(id).archived && !student.archived)) byKey.set(id, student);
  }
  const selected = new Map();
  const locations = new Map();
  for (const entry of entries) {
    const studentKey = key(entry);
    const location = normalizeRosterName(entry.local);
    if (locations.has(studentKey) && locations.get(studentKey) !== location) {
      throw Error('Há uma matrícula com o mesmo nome e horário em dois locais na planilha oficial.');
    }
    locations.set(studentKey, location);
    const old = byKey.get(studentKey);
    const id = old?.id ?? 'oficial:' + JSON.stringify([who, studentKey]);
    selected.set(id, {...old, ...entry, id, archived: false});
  }
  const existingIds = new Set(current.map(student => student.id));
  const roster = current.map(student => selected.get(student.id) ?? (student.archived ? student : {...student, archived: true}));
  for (const student of selected.values()) {
    if (!existingIds.has(student.id)) roster.push(student);
  }
  return {roster, active: selected.size};
}
