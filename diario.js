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
