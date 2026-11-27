// Uma operação por registro alterado. Reenvios conservam o identificador original.
function attendanceState(roster, db) {
  const result = new Map();
  for (const student of roster) result.set(JSON.stringify(['student', student.id]), student);
  for (const [lesson, record] of Object.entries(db.lessons)) {
    result.set(JSON.stringify(['cancellation', lesson]), {rain:!!record.rain, rainIds:record.rainIds||[], reason:record.reason||'Chuva'});
    for (const [id,value] of Object.entries(record.statusIds||{})) {
      result.set(JSON.stringify(['attendance',lesson,id]),value);
    }
  }
  for (const [id,value] of Object.entries(db.adjustments||{})) result.set(JSON.stringify(['adjustment',id]),value);
  return new Map([...result].map(([key,value])=>[key,structuredClone(value)]));
}
function attendanceChanges(before, after, createId) {
  const changes=[];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const previous=before.get(key), current=after.get(key);
    if(JSON.stringify(previous)!==JSON.stringify(current))changes.push([createId(),key,JSON.stringify(current??null)]);
  }
  return changes;
}
function readAttendanceLog(rows) {
  const seen=new Set(), state=new Map();
  for(const [event,key,json] of rows){
    if(!event||seen.has(event))continue;
    const value=JSON.parse(json);
    if(value===null)state.delete(key);else state.set(key,value);
    seen.add(event);
  }
  const students=[],lessons=Object.create(null),adjustments=Object.create(null);
  for(const [key,value] of state){
    const [type,id,student]=JSON.parse(key);
    if(type==='student')students.push(value);
    if(type==='adjustment')adjustments[id]=value;
    if(type==='attendance'||type==='cancellation'){
      const rec=lessons[id]??={rain:false,rainIds:[],statusIds:Object.create(null)};
      if(type==='attendance')rec.statusIds[student]=value;
      else Object.assign(rec,value);
    }
  }
  return {roster:students,db:{version:3,lessons,adjustments},seen};
}

// IDs remotos prevalecem quando nome, dia e horário identificam uma única matrícula.
function mergeInitialAttendance(local, remote) {
  const target = attendanceState(remote.roster, remote.db);
  const source = attendanceState(local.roster, local.db);
  const merged = new Map(target);
  const conflicts = [];
  const keyFor = s => JSON.stringify([s.nome.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR'),s.dia,s.hora.padStart(5,'0')]);
  const ids = new Map();
  for (const student of local.roster) {
    const exact = remote.roster.find(s=>s.id===student.id);
    const matches = remote.roster.filter(s=>keyFor(s)===keyFor(student));
    const uniqueLocal = local.roster.filter(s=>keyFor(s)===keyFor(student)).length===1;
    ids.set(student.id, exact?.id ?? (uniqueLocal && matches.length===1 ? matches[0].id : student.id));
  }
  const normalizedLesson = key => key.replace(/\|(\d):/g,'|0$1:');
  const remoteLessons = new Map(Object.keys(remote.db.lessons).map(k=>[normalizedLesson(k),k]));
  const lessonKey = k => remoteLessons.get(normalizedLesson(k)) || normalizedLesson(k);
  const creditKey = id => {
    if (typeof id!=='string') return id;
    try {
      const [lesson, student] = JSON.parse(id);
      return JSON.stringify([lessonKey(lesson),ids.get(student)||student]);
    } catch { return id; }
  };
  for (const [key, value] of source) {
    const [type, id, student] = JSON.parse(key);
    let mapped = key, candidate = value;
    if (type==='student') {
      mapped = JSON.stringify([type,ids.get(id)]);
      candidate = {...value,id:ids.get(id)};
      if (id!==ids.get(id)) continue;
    } else if (type==='attendance') {
      mapped = JSON.stringify([type,lessonKey(id),ids.get(student)||student]);
      if (!value) continue;
    } else if (type==='cancellation') {
      mapped = JSON.stringify([type,lessonKey(id)]);
      candidate = {...value,rainIds:[...new Set(value.rainIds.map(s=>ids.get(s)||s))].sort()};
    } else if (type==='adjustment' && value.kind==='manual') {
      candidate = {...value,student:ids.get(value.student)||value.student};
    } else if (type==='adjustment' && value.kind==='settle') {
      const credit=creditKey(value.credit);
      candidate={...value,credit};
      if(id.startsWith('baixa:')) mapped=JSON.stringify([type,'baixa:'+credit]);
    }

    if (!merged.has(mapped)) {
      merged.set(mapped,candidate);
      continue;
    }
    const current=merged.get(mapped);
    const comparable=type==='cancellation' ? {...current,rainIds:[...new Set(current.rainIds)].sort()} : current;
    if (JSON.stringify(comparable)===JSON.stringify(candidate)) continue;
    if (type==='cancellation' && current.rain && candidate.rain && current.reason===candidate.reason) {
      merged.set(mapped,{...current,rainIds:[...new Set([...current.rainIds,...candidate.rainIds])]});
    } else {
      conflicts.push({key:mapped,nuvem:current,aparelho:candidate});
    }
  }
  return {target,merged,conflicts};
}
