(() => {
  const sheets = {
    Osias:'1Cu3GEdy4wXvRSra3fd7jms8T0J9pGtQVXUF4oZ_Es2A',
    Pedro:'1zNk_4uLMsYGBW2tUq-65cQZTvIdu3kAX_xZHbc9-3Y4'
  };
  const googleClientId='234420364719-8kbakbe0pmfk1hid2t6m09fm0briro4t.apps.googleusercontent.com';
  const ownerKey='chamadas-professor-local', queueKey='chamadas-envios-v1';
  const hint=el('syncStatus');
  let teacher=localStorage.getItem(ownerKey), token='', expiry=0, busy=false, manager=false;
  let baseline=attendanceState(roster,db), generation=0, peer=null;
  let awaiting=read(queueKey,[]);
  const migrationKey='chamadas-backup-conciliacao-v1';
  const sessionKey='chamadas-sessao-v1';
  let session=readSession();
  let migrationNotice='';
  function readSession(){
    try{return JSON.parse(sessionStorage.getItem(sessionKey));}catch{return null;}
  }
  function clearSession(){
    token='';expiry=0;session=null;
    try{sessionStorage.removeItem(sessionKey);}catch{}
  }
  function saveSession(){
    try{sessionStorage.setItem(sessionKey,JSON.stringify({teacher,token,expiry}));}catch{}
  }
  function showMigration(){
    const saved=read(migrationKey,null);
    if(!saved)return;
    el('migrationBackup').hidden=false;
    el('migrationBackup').onclick=()=>download('backup-anterior-a-conciliacao.json',JSON.stringify(saved,null,2),'application/json');
    if(saved.destination!==teacher)return;
    migrationNotice=saved.previousTeacher==='Pedro'&&teacher==='Osias'
      ? ' · Histórico local do Pedro separado e preservado'
      : saved.conflicts.length ? ' · '+saved.conflicts.length+' divergências preservadas no backup da conciliação' : '';
  }
  const original=persist;
  const transitionKey='chamadas-vinculo-pendente-v1';
  function finishLink(link){
    const {destination,changes,next}=link;
    roster=next.roster;db=next.db;
    if(!original())throw Error('Não foi possível guardar a conciliação neste aparelho.');
    localStorage.setItem(queueKey,JSON.stringify(changes));
    localStorage.setItem(ownerKey,destination);
    teacher=destination;awaiting=changes;baseline=attendanceState(roster,db);
    localStorage.removeItem(transitionKey);
  }
  const transition=read(transitionKey,null);
  if(transition){
    try{finishLink(transition);rebuild();}catch(e){fail(e);return;}
  }
  if(teacher&&awaiting.length){
    const cached=[...baseline].map(([key,value],index)=>['cache:'+index,key,JSON.stringify(value)]);
    const recovery=readAttendanceLog(cached.concat(awaiting));
    roster=recovery.roster;db=recovery.db;baseline=attendanceState(roster,db);original();rebuild();
  }
  showMigration();
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
    const area=el('peerView'), creditsArea=el('peerCredits');area.replaceChildren();creditsArea.replaceChildren();
    if(!peer)return;
    const day=el('peerDate').value;
    const person=id=>peer.roster.find(x=>x.id===id)?.nome||'Aluno arquivado';
    const credits=pendingCredits(peer.db.lessons,peer.db.adjustments);
    const counts=creditCounts(credits);
    const add=(t,container=area,id)=>{const p=document.createElement('p');p.textContent=t;if(id)p.append(creditCount(counts,id));container.append(p);};
    let count=0;
    for(const [key,r] of Object.entries(peer.db.lessons).sort()){
      if(key.split('|')[0]!==day)continue;
      count++;add(key.split('|').slice(1).join(' · '));
      if(r.rain){
        for(const id of r.rainIds)add(person(id)+' · '+(r.reason||'Chuva'),area,id);
      }else{
        for(const [id,v] of Object.entries(r.statusIds))if(v)add(person(id)+' · '+({P:'Presente',F:'Falta',R:'Reposição'}[v]||v),area,id);
      }
    }
    if(!count)add('Nenhuma chamada enviada para esta data.');
    const heading=document.createElement('h2');heading.textContent='Reposições do Pedro';creditsArea.append(heading);
    if(!credits.length)add('Nenhuma reposição pendente.',creditsArea);
    for(const c of credits){
      add(person(c.student)+' · '+c.date+' · '+c.reason,creditsArea);
      action('Marcar realizada',()=>writePeer('baixa:'+c.id,{kind:'settle',credit:c.id}));
    }
    const select=document.createElement('select');select.setAttribute('aria-label','Aluno do Pedro');
    for(const s of peer.roster.filter(x=>!x.archived))select.add(new Option(s.nome+' · '+s.dia+' '+s.hora,s.id));
    if(select.length){creditsArea.append(select);action('Lançar reposição para aluno do Pedro',()=>{
      const reason=prompt('Motivo da reposição em '+day+':','Reposição manual');
      if(reason?.trim()&&day)return writePeer(makeId(),{kind:'manual',student:select.value,date:day,reason:reason.trim()});
    });}
    function action(label,run){
      const button=document.createElement('button');button.textContent=label;
      button.onclick=async()=>{button.disabled=true;try{await run();}finally{button.disabled=false;}};creditsArea.append(button);
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
      hint.textContent='Sincronizado · '+new Date().toLocaleTimeString('pt-BR')+migrationNotice;
    } catch(e){if(e.status===401)clearSession();fail(e);}finally{busy=false;}
  }
  async function loadSharedRoster(who){
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
  let sourceToken='', sourceExpiry=0;
  const refreshButton=el('refreshRoster');
  const workbookFallback=el('officialFileFallback');
  const workbookInput=el('officialFile');
  function requestWorkbookAccess(){
    if(sourceToken&&Date.now()<sourceExpiry)return Promise.resolve(sourceToken);
    if(!window.google?.accounts?.oauth2)return Promise.reject(new Error('Conecte à internet para acessar a planilha oficial.'));
    return new Promise((resolve,reject)=>{
      const oauth=google.accounts.oauth2;
      oauth.initTokenClient({
        client_id:googleClientId,
        scope:driveReadScope,
        callback:response=>{
          if(!response.access_token||!oauth.hasGrantedAllScopes(response,driveReadScope)){
            reject(new Error('Autorize o acesso ao Drive da conta que abre a planilha oficial.'));
            return;
          }
          sourceToken=response.access_token;
          sourceExpiry=Date.now()+1000*(Number(response.expires_in)-60);
          resolve(sourceToken);
        },
        error_callback:()=>reject(new Error('A autorização para ler a planilha oficial foi interrompida.'))
      }).requestAccessToken({prompt:'select_account'});
    });
  }
  async function readWorkbookFromDrive(){
    const accessToken=await requestWorkbookAccess();
    const url='https://www.googleapis.com/drive/v3/files/'+officialWorkbookId+'?alt=media';
    let response;
    for(let attempt=0;attempt<2;attempt++){
      try{
        response=await fetch(url,{cache:'no-store',headers:{Authorization:'Bearer '+accessToken}});
        break;
      }catch(error){
        if(!(error instanceof TypeError))throw error;
        if(attempt===1)throw Error('O app não conseguiu se conectar ao Google Drive. Tente novamente ou selecione o arquivo oficial abaixo.');
      }
    }
    if(!response.ok){
      if([401,403,404].includes(response.status)){sourceToken='';sourceExpiry=0;}
      throw Error('O Google Drive recusou a leitura da planilha oficial ('+response.status+').');
    }
    return response.arrayBuffer();
  }
  async function applyOfficialWorkbook(buffer){
    const entries=await readOfficialRoster(buffer,'Osias');
    const previous=roster;
    const result=reconcileOfficialRoster(previous,entries,'Osias');
    roster=result.roster;
    if(!persist()){
      roster=previous;
      throw Error('Não foi possível salvar a lista neste aparelho.');
    }
    rebuild();
    workbookFallback.hidden=true;
    alert(result.active+' matrículas ativas atualizadas da planilha oficial.');
  }
  function setRosterControlsBusy(busy){
    refreshButton.disabled=busy;
    workbookInput.disabled=busy;
  }
  refreshButton.onclick=async()=>{
    if(!teacher||!token||refreshButton.disabled)return;
    setRosterControlsBusy(true);
    try{
      if(teacher==='Osias')await applyOfficialWorkbook(await readWorkbookFromDrive());
      else{
        const count=await loadSharedRoster(teacher);
        alert(count+' novos horários importados da lista compartilhada.');
      }
    }catch(error){
      workbookFallback.hidden=teacher!=='Osias';
      fail(error);
    }finally{setRosterControlsBusy(false);}
  };
  workbookInput.onchange=async()=>{
    const file=workbookInput.files[0];
    if(!file||teacher!=='Osias'||workbookInput.disabled)return;
    setRosterControlsBusy(true);
    try{await applyOfficialWorkbook(await file.arrayBuffer());}
    catch{fail(Error('Não consegui importar este arquivo. Selecione a planilha oficial de cobranças em formato .xlsm.'));}
    finally{
      workbookInput.value='';
      setRosterControlsBusy(false);
    }
  };
  async function connect(response){
    if(!response.access_token)return fail(new Error('Acesso Google não concluído.'));
    if(busy)return;
    busy=true;
    manager=false;
    peer=null;
    el('peerTab').hidden=true;
    el('peerView').replaceChildren();el('peerCredits').replaceChildren();
    showTab('mine');
    el('refreshRoster').hidden=true;
    workbookFallback.hidden=true;
    token=response.access_token;expiry=Date.now()+1000*(response.expires_in-60);
    let loadInitialRoster=false;
    try{
      let canReadManager=false;
      try{await request('Osias',false,null,'A1');canReadManager=true;}catch(e){if(![403,404].includes(e.status))throw e;}
      const who=canReadManager?'Osias':'Pedro';
      const remoteRows=(await request(who,false)).values||[];
      const data=readAttendanceLog(remoteRows);
      if(teacher&&teacher!==who)throw Error('Este navegador está vinculado a outro professor. Use um perfil separado.');
      if(!teacher){
        let previousTeacher=who;
        let changes=[];
        if(baseline.size){
          if(who==='Osias'){
            const other=readAttendanceLog((await request('Pedro',false)).values||[]);
            const otherIds=new Set(other.roster.map(s=>s.id));
            const ownIds=new Set(data.roster.map(s=>s.id));
            const known=roster.filter(s=>otherIds.has(s.id)||ownIds.has(s.id));
            if(known.some(s=>otherIds.has(s.id))&&!known.some(s=>ownIds.has(s.id)))previousTeacher='Pedro';
          }
          const promptText=previousTeacher!==who
            ? 'Este aparelho guarda dados do Pedro. Abrir o registro de Osias e preservar os dados do Pedro num backup neste aparelho?'
            : 'Conciliar os dados deste aparelho com o registro de '+who+'? Confirme se os dados locais pertencem a esse professor.';
          if(!confirm(promptText)){clearSession();return;}
          const local={roster,db};
          const result=previousTeacher===who ? mergeInitialAttendance(local,data) : null;
          if(result)changes=attendanceChanges(result.target,result.merged,makeId);
          localStorage.setItem(migrationKey,JSON.stringify({
            version:3,roster,lessons:db.lessons,adjustments:db.adjustments||{},
            previousTeacher,destination:who,conflicts:result?.conflicts||[]
          }));
        }
        const next=readAttendanceLog(remoteRows.concat(changes));
        const link={destination:who,changes,next:{roster:next.roster,db:next.db}};
        localStorage.setItem(transitionKey,JSON.stringify(link));
        finishLink(link);
        showMigration();
      }
      manager=canReadManager;
      el('peerTab').hidden=!manager;
      saveSession();
      el('refreshRoster').hidden=false;
      refreshButton.textContent=who==='Osias'?'Atualizar turmas da lista oficial':'Atualizar turmas da lista compartilhada';
      loadInitialRoster=who==='Pedro'&&!roster.length&&!data.seen.size;
      rebuild();
    } catch(e){clearSession();fail(e);return;}finally{busy=false;}
    await sync();
    if(loadInitialRoster&&token){
      try{await loadSharedRoster(teacher);}catch(e){fail(e);}
    }
  }
  el('connect').onclick=()=>{
    if(busy)return;
    if(!window.google?.accounts?.oauth2){hint.textContent='Conecte à internet para entrar com Google.';return;}
    google.accounts.oauth2.initTokenClient({client_id:googleClientId,scope:'https://www.googleapis.com/auth/spreadsheets',callback:connect}).requestAccessToken({prompt:'select_account'});
  };
  el('peerDate').value=el('date').value;el('peerDate').onchange=drawPeer;
  window.addEventListener('online',resume);window.addEventListener('focus',sync);
  setInterval(()=>{if(!document.hidden)sync();},10000);
  if(teacher)hint.textContent='Salvo neste aparelho · conecte ao Google para sincronizar'+migrationNotice;
  function resume(){
    if(token)return sync();
    if(session?.teacher===teacher&&session.expiry>Date.now()&&navigator.onLine){
      connect({access_token:session.token,expires_in:(session.expiry-Date.now())/1000+60});
    }
  }
  resume();
})();
