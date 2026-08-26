'use client';

// 역극 (4.9) — 실시간 채팅형. 방 개설(자관 기반/자유) · 참여자에게만 존재 노출 ·
// 캐릭터 선택 발화(테마색 말풍선) · 지문(/desc) · 메시지 수정/삭제 · 완결/공개 전환 · HTML 내보내기
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useLocalList, newId } from '@/lib/postStore';
import {
  RpRoom, RpMessage, RP_SEED, hexRgb, rpLastDate, rpHasNew,
  RpMessageRow, RP_MSG_KEY, RP_MSG_SEED, messagesFor, rpMarkRead, rpMemberIds,
} from '@/lib/rpStore';
import { Character, CHAR_SEED, Relation, REL_SEED, charGrant } from '@/lib/charStore';
import { Modal, ConfirmModal, useConfirmDelete } from '@/components/ui/Modal';
import { KInput, KTextarea, KSelect, KCheck } from '@/components/ui/Kit';
import { CroppedBlobImg } from '@/components/ui/CropEditor';
import { EditableDesc, PageTitle } from '@/components/ui/PageText';
import { useToast } from '@/components/ui/Toast';
import { useMembers } from '@/lib/members';
import { pushNotif } from '@/lib/notifStore';

/** 캐릭터 얼굴 칩 (썸네일 or 데모 플레이스홀더) */
function Face({ ch, className }: { ch?: Character; className: string }) {
  return (
    <div className={`${className} ${!ch?.thumbId ? `ph ${ch?.thumbClass ?? ''}` : ''}`}>
      {ch?.thumbId && <CroppedBlobImg fileRef={ch.thumbId} crop={ch.thumbCrop} />}
    </div>
  );
}

const fmtHM = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function RpPage() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const del = useConfirmDelete();
  const [rooms, setRooms, loaded] = useLocalList<RpRoom>('ohome.rp.v1', RP_SEED);
  const [msgRows, setMsgRows] = useLocalList<RpMessageRow>(RP_MSG_KEY, RP_MSG_SEED);
  const [chars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  const [rels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  
  const [selId, setSelId] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState<'all' | 'ongoing' | 'done'>('ongoing');
  const [mListOpen, setMListOpen] = useState(false);
  const [mFocus, setMFocus] = useState(false);

  // 방 메시지 추출
  const msgsOf = useCallback((r: RpRoom) => messagesFor(msgRows, r.id, r.messages), [msgRows]);
  
  // 참여 회원 계산
  const memberIdsOf = useCallback((r: RpRoom) => rpMemberIds(r, rels, chars), [rels, chars]);

  // 참여자에게만 존재 노출
  const allMine = useMemo(() => {
    if (!user) return [];
    return rooms
      .filter(r => memberIdsOf(r).includes(user.id))
      .sort((a, b) => rpLastDate(b, msgsOf(b)).localeCompare(rpLastDate(a, msgsOf(a))));
  }, [rooms, user, memberIdsOf, msgsOf]);

  const myRooms = useMemo(() => allMine.filter(r => fStatus === 'all' || r.status === fStatus), [allMine, fStatus]);
  const sel = myRooms.find(r => r.id === selId) ?? myRooms[0];
  const cntS = (s: 'all' | 'ongoing' | 'done') => allMine.filter(r => s === 'all' || r.status === s).length;

  // 발화자 선택
  const activeRel = useMemo(() => rels.find(r => r.id === sel?.relId), [rels, sel?.relId]);
  
  const speakChars = useMemo(() => {
    if (activeRel) {
      const members = activeRel.members.map(m => chars.find(c => c.id === m.charId)).filter(Boolean) as Character[];
      return isAdmin ? members : members.filter(c => !!charGrant(c, user?.id));
    }
    return isAdmin ? chars.filter(c => c.own) : chars.filter(c => !!charGrant(c, user?.id));
  }, [activeRel, chars, isAdmin, user?.id]);

  const [speaker, setSpeaker] = useState<string>('');
  const [pickOpen, setPickOpen] = useState(false);

  useEffect(() => {
    if (speakChars.length > 0 && !speakChars.some(c => c.id === speaker) && speaker !== 'player' && speaker !== 'desc') {
      setSpeaker(speakChars[0].id);
    }
    setPickOpen(false);
  }, [sel?.id, speakChars, speaker]);

  // 입장 시 읽음 처리
  useEffect(() => {
    if (!sel || !user) return;
    rpMarkRead(sel.id, user.id);
  }, [sel?.id, user?.id, msgRows.length]);

  // 자동 스크롤
  const msgsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = msgsRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [sel?.id, msgRows.length]);

  const [text, setText] = useState('');
  const send = () => {
    if (!sel || !user) return;
    let t = text.trim();
    if (!t) return;
    
    let kind: RpMessage['kind'] = speaker === 'desc' ? 'desc' : speaker === 'player' ? 'player' : 'char';
    if (t.startsWith('/desc ')) { 
      kind = 'desc'; 
      t = t.slice(6).trim(); 
    }
    if (!t) return;

    const m: RpMessage = {
      id: newId(),
      kind,
      charId: kind === 'char' ? speaker : undefined,
      charOwn: kind === 'char' ? chars.find(c => c.id === speaker)?.own : undefined,
      authorId: user.id,
      text: t,
      date: new Date().toISOString(),
    };

    setMsgRows([...msgRows, { ...m, roomId: sel.id }]);
    rpMarkRead(sel.id, user.id, m.date);
    setText('');

    // 알림 발송
    memberIdsOf(sel)
      .filter(id => id !== user.id)
      .forEach(id => pushNotif({
        type: 'rp',
        toUserId: id,
        href: '/rp',
        dedupeKey: `rp:${sel.id}`,
        title: `역극 「${sel.title}」 새 메시지`,
        body: t.slice(0, 60),
      }));
  };

  // 메시지 수정/삭제
  const [editMsg, setEditMsg] = useState<RpMessage | null>(null);
  const [editText, setEditText] = useState('');
  
  const saveMsg = () => {
    if (!sel || !editMsg) return;
    if (!editText.trim()) { toast('내용을 입력해 주세요'); return; }
    const t = editText.trim();

    if (msgRows.some(x => x.id === editMsg.id)) {
      setMsgRows(msgRows.map(x => (x.id === editMsg.id ? { ...x, text: t } : x)));
    } else {
      setRooms(rooms.map(r => r.id === sel.id
        ? { ...r, messages: r.messages.map(m => m.id === editMsg.id ? { ...m, text: t } : m) } 
        : r));
    }
    setEditMsg(null);
  };

  const removeMsg = (m: RpMessage) => {
    if (!sel) return;
    del.ask('이 메시지를 삭제하시겠습니까?', () => {
      if (msgRows.some(x => x.id === m.id)) {
        setMsgRows(msgRows.filter(x => x.id !== m.id));
      } else {
        setRooms(rooms.map(r => r.id === sel.id
          ? { ...r, messages: r.messages.filter(x => x.id !== m.id) } 
          : r));
      }
    });
  };

  // 방 개설
  const [newOpen, setNewOpen] = useState(false);
  const [nTitle, setNTitle] = useState('');
  const [nRel, setNRel] = useState('none');
  const [nMembers, setNMembers] = useState<string[]>([]);
  const pool = useMembers();

  const newRelGrantNames = useMemo(() => {
    if (nRel === 'none' || !user) return [];
    const tempRoom: RpRoom = {
      id: '',
      title: '',
      relId: nRel,
      memberIds: [],
      status: 'ongoing',
      isPublic: false,
      createdBy: user.id,
      created: '',
      lastRead: {},
      messages: []
    };
    const ids = rpMemberIds(tempRoom, rels, chars);
    return ids.filter(id => id !== user.id)
      .map(id => pool.find(pp => pp.id === id)?.nickname ?? id);
  }, [nRel, user, rels, chars, pool]);

  const createRoom = () => {
    if (!user) return;
    if (!nTitle.trim()) { toast('방 제목을 입력해 주세요'); return; }
    const members = Array.from(new Set([user.id, ...nMembers]));
    const room: RpRoom = {
      id: newId(), 
      title: nTitle.trim(), 
      relId: nRel === 'none' ? undefined : nRel,
      memberIds: members, 
      status: 'ongoing', 
      isPublic: false,
      createdBy: user.id, 
      created: new Date().toISOString(), 
      lastRead: {}, 
      messages: [],
    };
    setRooms([room, ...rooms]);
    setSelId(room.id);
    setNewOpen(false);
    setNTitle(''); setNRel('none'); setNMembers([]);
  };

  const canManage = sel && user && (sel.createdBy === user.id || isAdmin);
  const [endAsk, setEndAsk] = useState(false);

  // 캐릭터 재연동
  const brokenChars = useMemo(() => {
    if (!sel) return [];
    const map = new Map<string, boolean>();
    for (const m of msgsOf(sel)) {
      if (m.kind === 'char' && m.charId && !chars.some(c => c.id === m.charId) && !map.has(m.charId)) {
        map.set(m.charId, !!m.charOwn);
      }
    }
    return [...map.entries()].map(([charId, own]) => ({ charId, own }));
  }, [sel, chars, msgsOf]);

  const [relinkOpen, setRelinkOpen] = useState(false);
  const [relinkSel, setRelinkSel] = useState<Record<string, string>>({});

  const relinkCands = (own: boolean): Character[] => {
    const sameSide = (c: Character) => !!c.own === own;
    const relList = activeRel
      ? (activeRel.members.map(mm => chars.find(c => c.id === mm.charId)).filter(Boolean) as Character[]).filter(sameSide)
      : [];
    return relList.length ? relList : chars.filter(sameSide);
  };

  const speakingIds = useMemo(() => new Set(
    (sel ? msgsOf(sel) : []).filter(m => m.kind === 'char' && m.charId).map(m => m.charId as string)
  ), [sel, msgsOf]);

  const applyRelink = () => {
    if (!sel) return;
    const picked = Object.entries(relinkSel).filter(([, v]) => v);
    if (picked.length === 0) { setRelinkOpen(false); return; }

    const relink = <M extends RpMessage>(m: M): M => {
      const nid = m.charId ? relinkSel[m.charId] : undefined;
      if (!nid) return m;
      return { ...m, charId: nid, charOwn: chars.find(c => c.id === nid)?.own };
    };

    setMsgRows(msgRows.map(x => (x.roomId === sel.id ? relink(x) : x)));
    setRooms(rooms.map(r => (r.id === sel.id ? { ...r, messages: r.messages.map(relink) } : r)));
    setRelinkOpen(false);
    setRelinkSel({});
    toast('캐릭터를 다시 연결했습니다');
  };

  const patchRoom = (p: Partial<RpRoom>) => {
    if (!sel) return;
    setRooms(rooms.map(r => r.id === sel.id ? { ...r, ...p } : r));
  };

  const removeRoom = () => {
    if (!sel) return;
    const count = msgsOf(sel).length;
    del.ask(`「${sel.title}」 방을 삭제하시겠습니까?`, () => {
      setRooms(rooms.filter(r => r.id !== sel.id));
      setMsgRows(msgRows.filter(x => x.roomId !== sel.id));
      setSelId(null);
    }, `대화 ${count}개도 함께 삭제됩니다.`);
  };

  // HTML 내보내기
  const exportHtml = () => {
    if (!sel) return;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
    const rows = msgsOf(sel).map(m => {
      if (m.kind === 'desc') {
        return `<p style="text-align:center;color:#4a505a;line-height:1.8;margin:14px 0">${esc(m.text)}</p>`;
      }
      const ch = chars.find(c => c.id === m.charId);
      const name = m.kind === 'player' ? '플레이어' : (ch?.name ?? '');
      const color = ch?.color ?? '#5d636d';
      return `<div style="margin:10px 0;line-height:1.7"><b style="color:${color};letter-spacing:.05em">${esc(name)}</b> — ${esc(m.text)}</div>`;
    }).join('\n');

    const html = `<div style="font-family:sans-serif;max-width:720px;margin:0 auto">
<h2 style="letter-spacing:.08em">${esc(sel.title)}</h2>
${rows}
</div>`;
    const u = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = u; 
    a.download = `${sel.title}.html`;
    a.click();
    URL.revokeObjectURL(u);
  };

  if (!loaded) return <section className="page" />;

  if (!user) {
    return (
      <section className="page">
        <div className="page-head">
          <PageTitle>ROLEPLAY</PageTitle>
          <EditableDesc k="rp-gate-desc" def="역극은 로그인한 참여자에게만 표시됩니다" always />
        </div>
      </section>
    );
  }

  const relCharNames = (relId?: string) => {
    const r = rels.find(x => x.id === relId);
    if (!r) return [];
    return r.members.map(m => chars.find(c => c.id === m.charId)?.name).filter(Boolean) as string[];
  };

  const roomLabel = (r: RpRoom) => {
    const rRel = rels.find(x => x.id === r.relId);
    if (!rRel) return '자유 개설';
    const names = relCharNames(r.relId);
    const isPair = rRel.kind === 'pair' || rRel.members.length === 2;
    return isPair && names.length ? names.join(' · ') : rRel.name;
  };

  const roomSub = (r: RpRoom) => [
    roomLabel(r),
    r.status === 'done' ? (r.isPublic ? '완결 · 공개 전환됨' : '완결') : '진행중',
  ].join(' · ');

  const speakerLabel = speaker === 'desc' ? '지문 (DESC)' : speaker === 'player'
    ? '플레이어' : (chars.find(c => c.id === speaker)?.name ?? '');
  const speakerChar = chars.find(c => c.id === speaker);

  return (
    <section className={`page ${mFocus ? 'rp-focus' : ''}`}>
      <div className="page-head">
        <PageTitle>ROLEPLAY</PageTitle>
        <EditableDesc k="rp-desc" def="실시간 채팅형 · 참여자에게만 존재 노출 · 캐릭터 선택 발화" />
      </div>

      <div className={`rp-layout ${mListOpen ? 'mopen' : ''}`}>
        <button type="button" className="rp-mfold" onClick={() => setMListOpen(o => !o)}>
          <b>{sel ? sel.title : '방 목록'}</b>
          <small>MY ROOMS {myRooms.length} {mListOpen ? '▴' : '▾'}</small>
        </button>

        <div className="panel rp-rooms">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px 12px', flexShrink: 0 }}>
            <b style={{ fontSize: 12, letterSpacing: '.1em', color: 'var(--sub)' }}>MY ROOMS</b>
            <button className="btn btn-dark" style={{ padding: '0 12px', height: 30, fontSize: 11 }}
              onClick={() => setNewOpen(true)}>＋ NEW ROOM</button>
          </div>
          <div className="rp-rooms-list">
            {myRooms.map(r => (
              <div key={r.id} className={`rp-room ${sel?.id === r.id ? 'on' : ''}`}
                onClick={() => { setSelId(r.id); setMListOpen(false); }}>
                <b>{r.title} {rpHasNew(r, user.id, msgsOf(r)) && sel?.id !== r.id && <span className="new">N</span>}</b>
                <small>{roomSub(r)}</small>
              </div>
            ))}
            {myRooms.length === 0 && (
              <p className="hint" style={{ padding: '10px 6px 0' }}>
                {fStatus === 'all' ? '참여 중인 방이 없습니다' : '이 상태의 방이 없습니다'}
              </p>
            )}
          </div>
        </div>

        <div className="panel rp-chat">
          {sel ? (
            <>
              <div className="rp-head">
                <div>
                  <b>{sel.title}</b>
                  <small>{roomLabel(sel)}</small>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="pill">{sel.status === 'done' ? (sel.isPublic ? '완결 · 공개' : '완결') : '진행중'}</span>
                  {canManage && brokenChars.length > 0 && (
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5, color: 'var(--accent)' }}
                      onClick={() => setRelinkOpen(true)}>RELINK</button>
                  )}
                  {canManage && sel.status === 'ongoing' && (
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                      onClick={() => setEndAsk(true)}>END</button>
                  )}
                  {canManage && sel.status === 'done' && (
                    <>
                      <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                        onClick={() => patchRoom({ status: 'ongoing', isPublic: false })}>REOPEN</button>
                      <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                        onClick={() => patchRoom({ isPublic: !sel.isPublic })}>
                        {sel.isPublic ? 'UNPUBLISH' : 'PUBLISH'}
                      </button>
                      <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                        onClick={exportHtml}>EXPORT</button>
                    </>
                  )}
                  {canManage && (
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                      onClick={removeRoom}>DELETE</button>
                  )}
                </div>
              </div>

              <div className="rp-msgs" ref={msgsRef}>
                {msgsOf(sel).map(m => {
                  const mine = m.authorId === user.id;
                  if (m.kind === 'desc') {
                    return (
                      <div key={m.id} className="msg-desc">
                        {m.text}
                        {mine && (
                          <span className="m-act">
                            <button onClick={() => { setEditMsg(m); setEditText(m.text); }}>EDIT</button>
                            <button onClick={() => removeMsg(m)}>DEL</button>
                          </span>
                        )}
                      </div>
                    );
                  }
                  const ch = chars.find(c => c.id === m.charId);
                  const name = m.kind === 'player' ? '플레이어' : (ch?.name ?? '');
                  const rightSide = m.kind === 'player'
                    ? mine
                    : (ch ? (!!charGrant(ch, user.id) || (!!ch.own && isAdmin)) : (!!m.charOwn && isAdmin));
                  return (
                    <div key={m.id} className={`msg ${rightSide ? 'me' : ''}`} style={{ ['--cc' as string]: hexRgb(ch?.color) }}>
                      <Face ch={ch} className="face" />
                      <div>
                        <div className="who">{name}</div>
                        <div className="bub">{m.text}</div>
                        <div style={{ fontSize: 9, color: 'var(--faint)', marginTop: 3 }}>{fmtHM(m.date)}</div>
                      </div>
                      {mine && (
                        <span className="m-act">
                          <button onClick={() => { setEditMsg(m); setEditText(m.text); }}>EDIT</button>
                          <button onClick={() => removeMsg(m)}>DEL</button>
                        </span>
                      )}
                    </div>
                  );
                })}
                {msgsOf(sel).length === 0 && (
                  <p className="hint" style={{ textAlign: 'center', marginTop: 30 }}>첫 메시지를 남겨보세요</p>
                )}
              </div>

              {sel.status === 'ongoing' && (
                <div className="rp-input">
                  <div className="char-pick" onClick={() => setPickOpen(o => !o)}>
                    {speaker === 'desc'
                      ? <div className="f" style={{ display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--sub)' }}>❝</div>
                      : speaker === 'player'
                        ? <div className="f" style={{ display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--sub)' }}>◉</div>
                        : <Face ch={speakerChar} className="f" />}
                    <small>{speakerLabel} ▾</small>
                    {pickOpen && (
                      <div className="rp-pick-pop" onClick={e => e.stopPropagation()}>
                        {speakChars.map(c => (
                          <button key={c.id} onClick={() => { setSpeaker(c.id); setPickOpen(false); }}>
                            <Face ch={c} className="f" />{c.name}
                          </button>
                        ))}
                        <button onClick={() => { setSpeaker('player'); setPickOpen(false); }}>
                          <span className="f" style={{ display: 'grid', placeItems: 'center', color: 'var(--sub)' }}>◉</span>
                          플레이어
                        </button>
                        <button onClick={() => { setSpeaker('desc'); setPickOpen(false); }}>
                          <span className="f" style={{ display: 'grid', placeItems: 'center', color: 'var(--sub)' }}>❝</span>
                          지문 (DESC)
                        </button>
                      </div>
                    )}
                  </div>
                  <KTextarea style={{ minHeight: 44 }} value={text} onChange={e => setText(e.target.value)}
                    onFocus={() => setMFocus(true)}
                    onBlur={() => setTimeout(() => setMFocus(false), 180)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                  <button className="btn btn-dark" onClick={send}>SEND</button>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
              <p className="hint">방을 개설하면 여기에 채팅이 표시됩니다</p>
            </div>
          )}
        </div>

        <div className="panel tagside" style={{ padding: 16, alignSelf: 'start' }}>
          <h4>상태</h4>
          <div className={`tag ${fStatus === 'ongoing' ? 'on' : ''}`} onClick={() => setFStatus('ongoing')}>
            진행중 <small>{cntS('ongoing')}</small>
          </div>
          <div className={`tag ${fStatus === 'all' ? 'on' : ''}`} onClick={() => setFStatus('all')}>
            전체 <small>{cntS('all')}</small>
          </div>
          <div className={`tag ${fStatus === 'done' ? 'on' : ''}`} onClick={() => setFStatus('done')}>
            완결 <small>{cntS('done')}</small>
          </div>
        </div>
      </div>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} small title="역극 방 개설"
        desc="비참여자에게는 방의 존재가 보이지 않습니다" dirty
        actions={<>
          <button className="btn btn-ghost" onClick={() => setNewOpen(false)}>CANCEL</button>
          <button className="btn btn-dark" onClick={createRoom}>ADD</button>
        </>}>
        <div style={{ display: 'grid', gap: 11 }}>
          <div>
            <label className="k-label" style={{ marginBottom: 5 }}>Title</label>
            <KInput value={nTitle} onChange={e => setNTitle(e.target.value)} />
          </div>
          <div>
            <label className="k-label" style={{ marginBottom: 5 }}>기반 자관 (선택)</label>
            <KSelect value={nRel} onChange={setNRel}
              options={[{ value: 'none', label: '자유 개설 (자관 없음)' }, ...rels.map(r => ({ value: r.id, label: r.name }))]} />
          </div>
          <div>
            <label className="k-label" style={{ marginBottom: 7 }}>참여 회원</label>
            {nRel === 'none' ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {pool.filter(p => p.id !== user.id).map(p => (
                  <KCheck key={p.id} label={p.nickname}
                    checked={nMembers.includes(p.id)}
                    onChange={v => setNMembers(ms => v ? [...ms, p.id] : ms.filter(x => x !== p.id))} />
                ))}
              </div>
            ) : (
              <p className="hint" style={{ margin: 0 }}>
                {newRelGrantNames.length
                  ? `이 자관 캐릭터에 권한이 있는 회원이 자동으로 참여합니다 — ${newRelGrantNames.join(' · ')}`
                  : '아직 이 자관 캐릭터에 권한을 준 회원이 없습니다 — 캐릭터 수정의 「회원 권한」에서 지정하면 이 방에도 자동으로 반영됩니다'}
              </p>
            )}
          </div>
        </div>
      </Modal>

      <Modal open={editMsg !== null} onClose={() => setEditMsg(null)} small title="메시지 수정" dirty
        actions={<>
          <button className="btn btn-ghost" onClick={() => setEditMsg(null)}>CANCEL</button>
          <button className="btn btn-dark" onClick={saveMsg}>SAVE</button>
        </>}>
        <KTextarea style={{ minHeight: 100 }} value={editText} onChange={e => setEditText(e.target.value)} />
      </Modal>

      <Modal open={relinkOpen} onClose={() => setRelinkOpen(false)} small title="캐릭터 다시 연결"
        desc="연결이 해제된 캐릭터의 발화를 다른 캐릭터로 옮깁니다 — 같은 영역(왼쪽/오른쪽)의 캐릭터만 선택할 수 있습니다" dirty
        actions={<>
          <button className="btn btn-ghost" onClick={() => setRelinkOpen(false)}>CANCEL</button>
          <button className="btn btn-dark" onClick={applyRelink}>APPLY</button>
        </>}>
        <div style={{ display: 'grid', gap: 12 }}>
          {brokenChars.map(b => (
            <div key={b.charId}>
              <label className="k-label" style={{ marginBottom: 5 }}>
                삭제된 캐릭터 — {b.own ? '내 캐릭터 영역 (내 캐릭터만 선택 가능)' : '상대 영역 (상대 캐릭터만 선택 가능)'}
              </label>
              <KSelect value={relinkSel[b.charId] ?? ''} onChange={v => setRelinkSel(s => ({ ...s, [b.charId]: v }))}
                options={[
                  { value: '', label: '선택 안 함' },
                  ...relinkCands(b.own).map(c => ({
                    value: c.id,
                    label: speakingIds.has(c.id) ? `${c.name} — 이미 발화 중 (대사가 합쳐집니다)` : c.name,
                  })),
                ]} />
            </div>
          ))}
        </div>
      </Modal>

      <ConfirmModal open={endAsk} title="역극을 완결 처리하시겠습니까?"
        body="완결 후에는 공개 전환과 로그 내보내기를 사용할 수 있습니다."
        onClose={() => setEndAsk(false)}
        buttons={[
          { label: 'END', kind: 'dark', onClick: () => { patchRoom({ status: 'done' }); setEndAsk(false); } },
          { label: 'CANCEL', kind: 'ghost', onClick: () => setEndAsk(false) },
        ]} />
      {del.element}
    </section>
  );
}
