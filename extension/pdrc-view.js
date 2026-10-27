/* Read-only PDRC presentation. Text is inserted via textContent, never source-controlled HTML. */
(function (root) {
  'use strict';
  let selectedId = '';
  let currentProjects = [];

  function el(tag, className = '', value = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== '') node.textContent = String(value);
    return node;
  }
  function text(parent, tag, className, value) {
    const node = el(tag, className, value || '—');
    parent.append(node);
    return node;
  }
  function label(value) {
    const raw = String(value || 'unknown').replace(/_/g, ' ').trim();
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Unknown';
  }
  function age(value) {
    const date = value ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) return 'Update unknown';
    const delta = Math.max(0, Date.now() - date.getTime());
    if (delta < 60000) return 'Just now';
    if (delta < 3600000) return Math.floor(delta / 60000) + 'm ago';
    if (delta < 86400000) return Math.floor(delta / 3600000) + 'h ago';
    return Math.floor(delta / 86400000) + 'd ago';
  }
  function makeLine(card, title, value) {
    const row = el('div','line');
    text(row,'div','label',title);
    text(row,'div','value',value);
    card.append(row);
  }
  function showDetails(host, project) {
    selectedId = project.id;
    host.replaceChildren();
    const head = el('div','details-head');
    const titleWrap = el('div');
    text(titleWrap,'div','eyebrow','PROJECT DETAILS · READ ONLY');
    text(titleWrap,'h2','',project.name);
    head.append(titleWrap);
    const close = el('button','button secondary','Close details');
    close.type = 'button';
    close.addEventListener('click', () => { host.hidden = true; selectedId = ''; });
    head.append(close);
    host.append(head);
    if (project.error) {
      text(host,'p','details-error',project.error);
      if (project.stale) text(host,'p','detail-subtle','Last good snapshot is shown below.');
    }
    const overview = el('div','detail-summary');
    makeLine(overview,'Status',project.status || 'Unknown');
    makeLine(overview,'Next',project.next || 'Not reported');
    if (project.phase) makeLine(overview,'Phase',label(project.phase));
    makeLine(overview,'Lifecycle',label(project.lifecycle));
    host.append(overview);

    const section = el('section','detail-section');
    text(section,'h3','','Deliverables');
    if (!project.deliverables?.length) {
      text(section,'p','detail-subtle','No structured deliverables reported by this project.');
    } else {
      text(section,'p','detail-subtle',project.totalDeliverables + ' recorded · ' +
        Object.entries(project.workStates).map(([state,count])=>count + ' ' + label(state).toLowerCase()).join(' · '));
      const scroll = el('div','detail-scroll');
      const table = el('table','detail-table');
      const header = el('thead');
      const top = el('tr');
      for (const name of ['ID','Deliverable','Work','Verification','Target']) text(top,'th','',name);
      header.append(top); table.append(header);
      const body = el('tbody');
      for (const item of project.deliverables) {
        const row = el('tr');
        for (const value of [item.id,item.title,label(item.workState),label(item.verificationState),item.targetDate||'—']) {
          text(row,'td','',value);
        }
        body.append(row);
      }
      table.append(body);scroll.append(table);section.append(scroll);
    }
    host.append(section);

    const timeline = el('section','detail-section');
    text(timeline,'h3','','Recent history');
    if (!project.events?.length) text(timeline,'p','detail-subtle','No project history reported.');
    else for (const event of project.events.slice(0, 12)) {
      const item = el('article','timeline-entry');
      text(item,'div','timeline-date',event.at || 'Timestamp unknown');
      text(item,'div','timeline-state',event.status || label(event.type));
      if (event.next) text(item,'div','detail-subtle','Next: ' + event.next);
      timeline.append(item);
    }
    host.append(timeline);

    if (project.sourceId) {
      const link = el('a','source-link','Open authoritative project sheet');
      link.href = 'https://docs.google.com/spreadsheets/d/' + project.sourceId + '/edit';
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      host.append(link);
    }
    host.hidden = false;
  }
  function render(cardsHost, detailsHost, projects) {
    currentProjects = projects;
    const frag = document.createDocumentFragment();
    for (const project of projects) {
      const card = el('article','card');
      const head = el('div','card-head');
      text(head,'div','project',project.name);
      text(head,'div','age',age(project.updated || project.fetchedAt));
      card.append(head);
      if (project.error) text(card,'div','source-warning',project.stale ? 'Cached · Source unavailable' : 'Source unavailable');
      makeLine(card,'Status',project.status || (project.error ? 'Unavailable' : 'Not reported'));
      makeLine(card,'Next',project.next || 'Not reported');
      if (project.phase) makeLine(card,'Phase',label(project.phase));
      const meta=el('div','meta');
      if (project.error && !project.stale) text(meta,'span','','History unavailable');
      else text(meta,'span','',project.count + ' update' + (project.count === 1 ? '' : 's') + ' / 7d');
      if (project.totalDeliverables) {
        const states=Object.entries(project.workStates).map(([state,count])=>count+' '+label(state).toLowerCase()).join(' · ');
        text(meta,'span','',project.totalDeliverables+' deliverables · '+states);
      }
      card.append(meta);
      const actions=el('div','card-actions');
      const open=el('button','button secondary','View details');
      open.type='button';
      open.addEventListener('click',()=>{
        showDetails(detailsHost,project);
        detailsHost.focus();
      });
      actions.append(open);card.append(actions);frag.append(card);
    }
    cardsHost.replaceChildren(frag);
    if (selectedId) {
      const selected = projects.find(p=>p.id===selectedId);
      if (selected) showDetails(detailsHost,selected);
      else {selectedId='';detailsHost.hidden=true;}
    } else detailsHost.hidden=true;
  }
  function clear(detailsHost) {
    selectedId='';currentProjects=[];detailsHost.replaceChildren();detailsHost.hidden=true;
  }
  root.PDRCView=Object.freeze({render,clear});
})(globalThis);
