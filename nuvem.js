(() => {
  const sheets = {
    Osias:'1Cu3GEdy4wXvRSra3fd7jms8T0J9pGtQVXUF4oZ_Es2A',
    Pedro:'1zNk_4uLMsYGBW2tUq-65cQZTvIdu3kAX_xZHbc9-3Y4'
  };
  const ownerKey='chamadas-professor-local', queueKey='chamadas-envios-v1';
  const hint=el('syncStatus');
  let teacher=localStorage.getItem(ownerKey), token='', expiry=0, busy=false, manager=false;
  let baseline=attendanceState(roster,db), generation=0, peer=null;
  let awaiting=read(queueKey,[]);
  const original=persist;
  persist=function(){
    if(!teacher){baseline=attendanceState(roster,db);return original();}
    const now=attendanceState(roster,db);
    const changes=attendanceChanges(baseline,now,makeId);
    if(!changes.length)return original();
    try {
      const next=awaiting.concat(changes);
      localStorage.setItem(queueKey,JSON.stringify(next));
      awaiting=next;generation++;baseline=now;
    } catch {alert('Falha ao guardar o envio. Exporte um backup.');return false;}
    const saved=original();
    hint.textContent='Salvo neste aparelho · aguardando sincronização';
    setTimeout(sync,250);return saved;
  };
  async function request(who,append,body,range='A:C'){
    const url='https://sheets.googleapis.com/v4/spreadsheets/'+sheets[who]+'/values/'+encodeURIComponent(range)+(append?':append?valueInputOption=RAW&insertDataOption=OVERWRITE':'');
    const r=await fetch(url,{method:append?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+token,...(append?{'Content-Type':'application/json'}:{})},body:append?JSON.stringify({values:body}):undefined});
    if(!r.ok){const e=new Error(r.status===401?'Conecte novamente ao Google.':'Falha ao acessar o registro de '+who+' ('+r.status+').');e.status=r.status;throw e;}
    return r.json();
  }
  function drawPeer(){
    const area=el('peerView');area.replaceChildren();
    if(!peer)return;
    const day=el('peerDate').value;
    const person=id=>peer.roster.find(x=>x.id===id)?.nome||'Aluno arquivado';
    const add=t=>{const p=document.createElement('p');p.textContent=t;area.append(p);};
    let count=0;
    for(const [key,r] of Object.entries(peer.db.lessons).sort()){
      if(key.split('|')[0]!==day)continue;
      count++;add(key.split('|').slice(1).join(' · '));
      if(r.rain)add((r.reason||'Chuva')+' · '+r.rainIds.map(person).join(', '));
      else for(const [id,v] of Object.entries(r.statusIds))if(v)add(person(id)+' · '+({P:'Presente',F:'Falta',R:'Reposição'}[v]||v));
    }
    if(!count)add('Nenhuma chamada enviada para esta data.');
    add('Reposições pendentes do Pedro');
    const credits=pendingCredits(peer.db.lessons,peer.db.adjustments);
    if(!credits.length)add('Nenhuma reposição pendente.');
    for(const c of credits){
      add(person(c.student)+' · '+c.date+' · '+c.reason);
      action('Marcar realizada',()=>writePeer('baixa:'+c.id,{kind:'settle',credit:c.id}));
    }
    const select=document.createElement('select');select.setAttribute('aria-label','Aluno do Pedro');
    for(const s of peer.roster.filter(x=>!x.archived))select.add(new Option(s.nome+' · '+s.dia+' '+s.hora,s.id));
    if(select.length){area.append(select);action('Lançar reposição para aluno do Pedro',()=>{
      const reason=prompt('Motivo da reposição em '+day+':','Reposição manual');
      if(reason?.trim()&&day)return writePeer(makeId(),{kind:'manual',student:select.value,date:day,reason:reason.trim()});
    });}
    function action(label,run){
      const button=document.createElement('button');button.textContent=label;
      button.onclick=async()=>{button.disabled=true;try{await run();}finally{button.disabled=false;}};area.append(button);
    }
  }
  async function writePeer(id,value){
    if(!manager||!navigator.onLine)return fail(new Error('Conecte-se para atualizar o registro do Pedro.'));
    try{
      await request('Pedro',true,[[id,JSON.stringify(['adjustment',id]),JSON.stringify(value)]]);
      peer=readAttendanceLog((await request('Pedro',false)).values||[]);drawPeer();
    }catch(e){fail(e);}
  }
  function fail(e){hint.textContent=e.message+' Registros locais preservados.';}
  async function sync(){
    if(busy||!teacher||!token||!navigator.onLine)return;
    if(Date.now()>=expiry){hint.textContent='Sessão expirada · conectar com Google para enviar';return;}
    busy=true;
    try{
      const version=generation;
      let data=readAttendanceLog((await request(teacher,false)).values||[]);
      if(version!==generation)return;
      const pending=awaiting.filter(x=>!data.seen.has(x[0]));
      for(let n=0;n<pending.length;n+=200)await request(teacher,true,pending.slice(n,n+200));
      if(pending.length)data=readAttendanceLog((await request(teacher,false)).values||[]);
      awaiting=awaiting.filter(x=>!data.seen.has(x[0]));
      localStorage.setItem(queueKey,JSON.stringify(awaiting));
      if(version!==generation||awaiting.length)return;
      roster=data.roster;db=data.db;baseline=attendanceState(roster,db);original();rebuild();
      if(manager){peer=readAttendanceLog((await request('Pedro',false)).values||[]);drawPeer();}
      hint.textContent='Sincronizado · '+new Date().toLocaleTimeString('pt-BR');
    } catch(e){fail(e);}finally{busy=false;}
  }
  async function loadRoster(who){
    const rows=(await request(who,false,null,'E2:H')).values||[];
    const key=x=>[x.nome.trim().toLocaleLowerCase('pt-BR'),x.dia,x.hora].join('|');
    const known=new Set(roster.map(key)), added=[];
    for(const [nome,dia,hora,local] of rows){
      if(!nome||!days.includes(dia)||!/^\d{2}:\d{2}$/.test(hora))continue;
      const student={nome,dia,hora,local:local||'',id:'cad:'+JSON.stringify([who,nome,dia,hora]),archived:false};
      if(!known.has(key(student))){added.push(student);known.add(key(student));}
    }
    if(added.length){roster.push(...added);persist();rebuild();}
    return added.length;
  }
  el('refreshRoster').onclick=async()=>{
    if(!teacher||!token)return;
    try{const count=await loadRoster(teacher);alert(count+' novos horários importados.');}catch(e){fail(e);}
  };
  async function connect(response){
    if(!response.access_token)return fail(new Error('Acesso Google não concluído.'));
    if(busy)return;
    busy=true;
    manager=false;
    peer=null;
    el('peerPanel').hidden=true;
    el('refreshRoster').hidden=true;
    token=response.access_token;expiry=Date.now()+1000*(response.expires_in-60);
    let loadInitialRoster=false;
    try{
      let canReadManager=false;
      try{await request('Osias',false,null,'A1');canReadManager=true;}catch(e){if(![403,404].includes(e.status))throw e;}
      const who=canReadManager?'Osias':'Pedro';
      const data=readAttendanceLog((await request(who,false)).values||[]);
      if(teacher&&teacher!==who)throw Error('Este navegador está vinculado a outro professor. Use um perfil separado.');
      if(!teacher){
        if(!confirm('Vincular os dados deste aparelho ao registro de '+who+'?')){token='';return;}
        baseline=attendanceState(roster,db);
        if(data.seen.size && baseline.size)throw Error('Já há histórico no aparelho e na nuvem. Exporte o backup para conciliar os dois históricos.');
        awaiting=attendanceChanges(new Map(),baseline,makeId);
        localStorage.setItem(queueKey,JSON.stringify(awaiting));localStorage.setItem(ownerKey,who);teacher=who;
      }
      manager=canReadManager;
      el('peerPanel').hidden=!manager;
      el('refreshRoster').hidden=false;
      loadInitialRoster=!roster.length&&!data.seen.size;
    } catch(e){token='';fail(e);return;}finally{busy=false;}
    await sync();
    if(loadInitialRoster&&token){
      try{await loadRoster(teacher);}catch(e){fail(e);}
    }
  }
  el('connect').onclick=()=>{
    if(busy)return;
    if(!window.google?.accounts?.oauth2){hint.textContent='Conecte à internet para entrar com Google.';return;}
    google.accounts.oauth2.initTokenClient({client_id:'234420364719-8kbakbe0pmfk1hid2t6m09fm0briro4t.apps.googleusercontent.com',scope:'https://www.googleapis.com/auth/spreadsheets',callback:connect}).requestAccessToken({prompt:'select_account'});
  };
  el('peerDate').value=el('date').value;el('peerDate').onchange=drawPeer;
  window.addEventListener('online',sync);window.addEventListener('focus',sync);
  setInterval(()=>{if(!document.hidden)sync();},10000);
  if(teacher)hint.textContent='Salvo neste aparelho · conecte ao Google para sincronizar';
})();
