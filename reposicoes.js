// Os registros antigos de chuva são lidos diretamente do histórico.
function pendingCredits(records, adjustments = {}) {
  const credits = new Map();
  const attended = [];
  for (const [lesson, record] of Object.entries(records).sort()) {
    if (record.rain) {
      for (const student of new Set(record.rainIds || [])) {
        const id = JSON.stringify([lesson, student]);
        credits.set(id, {id, student, date:lesson.split('|')[0], reason:record.reason || 'Chuva'});
      }
    } else {
      for (const [student, status] of Object.entries(record.statusIds || {})) {
        if (status === 'R') attended.push({student, date:lesson.split('|')[0]});
      }
    }
  }
  for (const [id, event] of Object.entries(adjustments)) {
    if (event.kind === 'manual') credits.set(id, {...event, id});
  }
  for (const event of Object.values(adjustments)) {
    if (event.kind === 'settle') credits.delete(event.credit);
  }
  const ordered = [...credits.values()].sort((a,b)=>a.date.localeCompare(b.date));
  for (const {student,date} of attended) {
    const credit = ordered.find(c=>credits.has(c.id) && c.student===student && c.date<=date);
    if (credit) credits.delete(credit.id);
  }
  return ordered.filter(c=>credits.has(c.id));
}
