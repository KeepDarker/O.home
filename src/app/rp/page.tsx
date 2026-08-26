import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Modal, Select, Spin, Tag, Tooltip, message as antMessage, Space } from 'antd';
import {
  UserOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  SendOutlined, LockOutlined, UnlockOutlined
} from '@ant-design/icons';
import {
  addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc,
  where, deleteDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import './RpWindow.css';

// --- Types ---
export interface RpCharacter {
  id: string;
  roomId: string;
  name: string;
  color?: string;
  avatarUrl?: string;
  memo?: string;
  grants?: string[];
  own?: string;
  createdAt?: any;
}

export interface RpWindowProps {
  room: { id: string; title: string; hostId: string; members?: string[] };
  user: { id: string; nickname?: string };
  isAdmin: boolean;
}

type MsgKind = 'player' | 'char' | 'narration' | 'dice';

interface RpMsg {
  id: string;
  roomId: string;
  kind: MsgKind;
  text: string;
  authorId: string;
  authorName: string;
  charId?: string;
  charName?: string;
  charColor?: string;
  charAvatar?: string;
  targetCharIds?: string[];
  charOwn?: string;
  isSecret?: boolean;
  diceDetail?: string;
  createdAt?: any;
}

const DEFAULT_AVATAR = 'https://api.dicebear.com/7.x/bottts/svg?seed=rp-default';

export const RpWindow: React.FC<RpWindowProps> = ({ room, user, isAdmin }) => {
  const [chars, setChars] = useState<RpCharacter[]>([]);
  const [loadingChars, setLoadingChars] = useState(true);

  const [rawMsgs, setRawMsgs] = useState<RpMsg[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(true);

  const [activeCharId, setActiveCharId] = useState<string | null>(null);

  const [kind, setKind] = useState<MsgKind>('player');
  const [charId, setCharId] = useState<string | undefined>(undefined);
  const [isSecret, setIsSecret] = useState(false);
  const [targetCharIds, setTargetCharIds] = useState<string[]>([]);
  const [text, setText] = useState('');

  const [editMsgId, setEditMsgId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const [diceCount, setDiceCount] = useState<number>(1);
  const [diceSides, setDiceSides] = useState<number>(6);

  const [cModal, setCModal] = useState(false);
  const [cEditId, setCEditId] = useState<string | null>(null);
  const [cName, setCName] = useState('');
  const [cColor, setCColor] = useState('#3b82f6');
  const [cAvatar, setCAvatar] = useState('');
  const [cMemo, CSetMemo] = useState('');
  const [cOwn, setCOwn] = useState('');
  const [cGrants, setCGrants] = useState<string[]>([]);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  // 캐릭터 구독
  useEffect(() => {
    if (!room?.id) return;
    setLoadingChars(true);
    const q = query(collection(db, 'rp_characters'), where('roomId', '==', room.id));
    const unsub = onSnapshot(q, (snap) => {
      const list: RpCharacter[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as RpCharacter));
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setChars(list);
      setLoadingChars(false);
    }, (err) => {
      console.error(err);
      setLoadingChars(false);
    });
    return () => unsub();
  }, [room?.id]);

  // 메세지 구독
  useEffect(() => {
    if (!room?.id) return;
    setLoadingMsgs(true);
    const q = query(
      collection(db, 'rp_messages'),
      where('roomId', '==', room.id),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: RpMsg[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as RpMsg));
      setRawMsgs(list);
      setLoadingMsgs(false);
    }, (err) => {
      console.error(err);
      setLoadingMsgs(false);
    });
    return () => unsub();
  }, [room?.id]);

  const charMap = useMemo(() => {
    const map = new Map<string, RpCharacter>();
    chars.forEach((c) => map.set(c.id, c));
    return map;
  }, [chars]);

  const charGrant = (c: RpCharacter, uid: string) => {
    if (c.own === uid) return 'own';
    if (c.grants?.includes(uid)) return 'grant';
    return null;
  };

  const myChars = useMemo(() => {
    return chars.filter((c) => isAdmin || c.own === user.id || c.grants?.includes(user.id));
  }, [chars, isAdmin, user.id]);

  useEffect(() => {
    if (myChars.length > 0) {
      if (!activeCharId || !myChars.some((c) => c.id === activeCharId)) {
        setActiveCharId(myChars[0].id);
      }
    } else {
      setActiveCharId(null);
    }
  }, [myChars, activeCharId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [rawMsgs.length, activeCharId]);

  const sel = activeCharId;

  const msgsOf = (cId: string | null): RpMsg[] => {
    return rawMsgs.filter((m) => {
      if (m.isSecret) {
        const isAuth = m.authorId === user.id || isAdmin;
        const targetMatch = cId ? m.targetCharIds?.includes(cId) : false;
        if (!isAuth && !targetMatch) return false;
      }
      return true;
    });
  };

  const handleSend = async () => {
    if (!text.trim() && kind !== 'dice') return;
    try {
      let cObj = charId ? charMap.get(charId) : undefined;
      if (kind === 'char' && !cObj && sel) {
        cObj = charMap.get(sel);
      }

      let payload: Partial<RpMsg> = {
        roomId: room.id,
        kind,
        text: text.trim(),
        authorId: user.id,
        authorName: user.nickname || 'Unknown',
        createdAt: serverTimestamp(),
      };

      if (kind === 'char') {
        if (!cObj) {
          antMessage.warning('대사할 캐릭터를 선택하세요.');
          return;
        }
        payload.charId = cObj.id;
        payload.charName = cObj.name;
        payload.charColor = cObj.color || '#3b82f6';
        payload.charAvatar = cObj.avatarUrl || DEFAULT_AVATAR;
        payload.charOwn = cObj.own;
      }

      if (isSecret) {
        payload.isSecret = true;
        payload.targetCharIds = targetCharIds;
      }

      if (kind === 'dice') {
        const rolls: number[] = [];
        let sum = 0;
        for (let i = 0; i < diceCount; i++) {
          const r = Math.floor(Math.random() * diceSides) + 1;
          rolls.push(r);
          sum += r;
        }
        payload.text = `🎲 ${diceCount}d${diceSides} 주사위 결과: [ ${rolls.join(', ')} ] = ${sum}`;
        payload.diceDetail = JSON.stringify({ count: diceCount, sides: diceSides, rolls, sum });
      }

      await addDoc(collection(db, 'rp_messages'), payload);
      setText('');
      if (kind === 'dice') setKind('player');
    } catch (e) {
      console.error(e);
      antMessage.error('메시지 전송 실패');
    }
  };

  const handleDeleteMsg = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'rp_messages', id));
    } catch (e) {
      antMessage.error('삭제 실패');
    }
  };

  const handleUpdateMsg = async () => {
    if (!editMsgId) return;
    try {
      await updateDoc(doc(db, 'rp_messages', editMsgId), {
        text: editText,
        updatedAt: serverTimestamp(),
      });
      setEditMsgId(null);
      setEditText('');
    } catch (e) {
      antMessage.error('수정 실패');
    }
  };

  const openCharModal = (c?: RpCharacter) => {
    if (c) {
      setCEditId(c.id);
      setCName(c.name);
      setCColor(c.color || '#3b82f6');
      setCAvatar(c.avatarUrl || '');
      CSetMemo(c.memo || '');
      setCOwn(c.own || '');
      setCGrants(c.grants || []);
    } else {
      setCEditId(null);
      setCName('');
      setCColor('#3b82f6');
      setCAvatar('');
      CSetMemo('');
      setCOwn(user.id);
      setCGrants([]);
    }
    setCModal(true);
  };

  const handleSaveChar = async () => {
    if (!cName.trim()) {
      antMessage.warning('캐릭터 이름을 입력하세요.');
      return;
    }
    try {
      const data = {
        roomId: room.id,
        name: cName.trim(),
        color: cColor,
        avatarUrl: cAvatar.trim() || DEFAULT_AVATAR,
        memo: cMemo.trim(),
        own: cOwn,
        grants: cGrants,
        updatedAt: serverTimestamp(),
      };

      if (cEditId) {
        await updateDoc(doc(db, 'rp_characters', cEditId), data);
      } else {
        await addDoc(collection(db, 'rp_characters'), {
          ...data,
          createdAt: serverTimestamp(),
        });
      }
      setCModal(false);
      antMessage.success('캐릭터 저장 완료');
    } catch (e) {
      antMessage.error('저장 실패');
    }
  };

  const handleDeleteChar = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'rp_characters', id));
      if (activeCharId === id) setActiveCharId(null);
      antMessage.success('캐릭터 삭제 완료');
    } catch (e) {
      antMessage.error('삭제 실패');
    }
  };

  const activeChar = sel ? charMap.get(sel) : null;

  return (
    <div className="rp-window-container">
      {/* 탭 헤더 */}
      <div className="rp-tabs">
        <button
          className={`rp-tab-item ${sel === null ? 'active' : ''}`}
          onClick={() => setActiveCharId(null)}
        >
          <UserOutlined /> 전체 관람 / 플레이어
        </button>
        {myChars.map((c) => (
          <button
            key={c.id}
            className={`rp-tab-item ${sel === c.id ? 'active' : ''}`}
            onClick={() => setActiveCharId(c.id)}
            style={{ borderBottomColor: sel === c.id ? c.color : 'transparent' }}
          >
            <span className="rp-tab-color" style={{ backgroundColor: c.color || '#3b82f6' }} />
            {c.name}
          </button>
        ))}
        {isAdmin && (
          <button className="rp-tab-add" onClick={() => openCharModal()}>
            <PlusOutlined /> 캐릭터 추가
          </button>
        )}
      </div>

      {/* 액티브 캐릭터 정보 바 */}
      {activeChar && (
        <div className="rp-char-bar" style={{ borderLeftColor: activeChar.color || '#3b82f6' }}>
          <img className="rp-char-avatar" src={activeChar.avatarUrl || DEFAULT_AVATAR} alt="" />
          <div className="rp-char-info">
            <div className="rp-char-name">
              {activeChar.name}
              <Tag color="blue" style={{ marginLeft: 8 }}>
                {charGrant(activeChar, user.id) === 'own' ? '소유자' : '권한부여됨'}
              </Tag>
            </div>
            {activeChar.memo && <div className="rp-char-memo">{activeChar.memo}</div>}
          </div>
          {isAdmin && (
            <div className="rp-char-actions">
              <Button icon={<EditOutlined />} size="small" onClick={() => openCharModal(activeChar)} />
              <Button
                icon={<DeleteOutlined />}
                danger
                size="small"
                onClick={() => handleDeleteChar(activeChar.id)}
              />
            </div>
          )}
        </div>
      )}

      {/* 메시지 출력 영역 */}
      <div className="rp-msgs">
        {loadingMsgs ? (
          <div className="rp-center"><Spin /></div>
        ) : msgsOf(sel).length === 0 ? (
          <div className="rp-empty">메시지가 없습니다.</div>
        ) : (
          msgsOf(sel).map((m) => {
            // 내가 쓴 메시지인지 판단
            const isMine = m.authorId === user.id;
            const isEdit = editMsgId === m.id;

            return (
              <div
                key={m.id}
                className={`rp-msg-row ${m.kind} ${isMine ? 'me' : 'other'} ${m.isSecret ? 'secret' : ''}`}
              >
                {/* 상대방 메시지 아바타 (왼쪽) */}
                {!isMine && (
                  <div className="rp-msg-avatar-wrap">
                    {m.kind === 'char' ? (
                      <img className="rp-msg-avatar" src={m.charAvatar || DEFAULT_AVATAR} alt="" />
                    ) : (
                      <div className="rp-msg-avatar-player"><UserOutlined /></div>
                    )}
                  </div>
                )}

                <div className="rp-msg-content">
                  {/* 상단 헤더 (이름 & 비밀글 태그) */}
                  <div className="rp-msg-header">
                    {m.kind === 'char' ? (
                      <span className="rp-msg-charname" style={{ color: m.charColor || '#3b82f6' }}>
                        {m.charName} <span className="rp-msg-author">({m.authorName})</span>
                      </span>
                    ) : (
                      <span className="rp-msg-author">{m.authorName}</span>
                    )}

                    {m.isSecret && (
                      <Tag icon={<LockOutlined />} color="red" style={{ marginLeft: 6 }}>
                        귓속말
                      </Tag>
                    )}
                  </div>

                  {/* 메시지 말풍선 본문 */}
                  {isEdit ? (
                    <div className="rp-msg-edit-box">
                      <Input.TextArea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        autoSize={{ minRows: 1, maxRows: 4 }}
                      />
                      <Space style={{ marginTop: 4 }}>
                        <Button type="primary" size="small" onClick={handleUpdateMsg}>저장</Button>
                        <Button size="small" onClick={() => setEditMsgId(null)}>취소</Button>
                      </Space>
                    </div>
                  ) : (
                    <div className="rp-msg-bubble">
                      {m.kind === 'narration' ? <em>{m.text}</em> : m.text}
                    </div>
                  )}

                  {/* 호버 액션 버튼 (수정/삭제) */}
                  {(m.authorId === user.id || isAdmin) && !isEdit && (
                    <div className="rp-msg-hover-actions">
                      <Button icon={<EditOutlined />} type="text" size="small" onClick={() => { setEditMsgId(m.id); setEditText(m.text); }} />
                      <Button icon={<DeleteOutlined />} type="text" danger size="small" onClick={() => handleDeleteMsg(m.id)} />
                    </div>
                  )}
                </div>

                {/* 내 메시지 아바타 (오른쪽) */}
                {isMine && (
                  <div className="rp-msg-avatar-wrap">
                    {m.kind === 'char' ? (
                      <img className="rp-msg-avatar" src={m.charAvatar || DEFAULT_AVATAR} alt="" />
                    ) : (
                      <div className="rp-msg-avatar-player me"><UserOutlined /></div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* 입력 컨트롤 바 */}
      <div className="rp-input-panel">
        <div className="rp-input-options">
          <Select
            value={kind}
            onChange={(v) => setKind(v)}
            style={{ width: 110 }}
            options={[
              { value: 'player', label: '플레이어' },
              { value: 'char', label: '캐릭터' },
              { value: 'narration', label: '나레이션' },
              { value: 'dice', label: '주사위' },
            ]}
          />

          {kind === 'char' && (
            <Select
              placeholder="캐릭터 선택"
              value={charId || sel || undefined}
              onChange={(v) => setCharId(v)}
              style={{ width: 140 }}
              options={myChars.map((c) => ({ value: c.id, label: c.name }))}
            />
          )}

          {kind === 'dice' && (
            <Space className="rp-dice-inputs">
              <Input
                type="number"
                min={1}
                max={20}
                value={diceCount}
                onChange={(e) => setDiceCount(Number(e.target.value))}
                addonAfter="개"
                style={{ width: 90 }}
              />
              <span>D</span>
              <Input
                type="number"
                min={2}
                max={100}
                value={diceSides}
                onChange={(e) => setDiceSides(Number(e.target.value))}
                addonAfter="면"
                style={{ width: 90 }}
              />
            </Space>
          )}

          <Tooltip title="특정 캐릭터에게만 보이는 귓속말">
            <Button
              type={isSecret ? 'primary' : 'default'}
              danger={isSecret}
              icon={isSecret ? <LockOutlined /> : <UnlockOutlined />}
              onClick={() => setIsSecret(!isSecret)}
            >
              귓속말
            </Button>
          </Tooltip>

          {isSecret && (
            <Select
              mode="multiple"
              placeholder="수신 캐릭터 선택"
              value={targetCharIds}
              onChange={(v) => setTargetCharIds(v)}
              style={{ minWidth: 160, flex: 1 }}
              options={chars.map((c) => ({ value: c.id, label: c.name }))}
            />
          )}
        </div>

        {kind !== 'dice' && (
          <div className="rp-input-box">
            <Input.TextArea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                kind === 'narration'
                  ? '나레이션 내용을 입력하세요...'
                  : kind === 'char'
                  ? '캐릭터 대사를 입력하세요...'
                  : '플레이어 메시지를 입력하세요...'
              }
              autoSize={{ minRows: 1, maxRows: 4 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button type="primary" icon={<SendOutlined />} onClick={handleSend}>
              전송
            </Button>
          </div>
        )}

        {kind === 'dice' && (
          <Button type="primary" block icon={<SendOutlined />} onClick={handleSend} style={{ marginTop: 8 }}>
            주사위 굴리기
          </Button>
        )}
      </div>

      {/* 캐릭터 생성/수정 모달 */}
      <Modal
        title={cEditId ? '캐릭터 수정' : '캐릭터 생성'}
        open={cModal}
        onOk={handleSaveChar}
        onCancel={() => setCModal(false)}
        okText="저장"
        cancelText="취소"
      >
        <div className="rp-modal-form">
          <label>캐릭터 이름</label>
          <Input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="이름" />

          <label>테마 색상</label>
          <Input type="color" value={cColor} onChange={(e) => setCColor(e.target.value)} />

          <label>아바타 이미지 URL</label>
          <Input value={cAvatar} onChange={(e) => setCAvatar(e.target.value)} placeholder="https://..." />

          <label>메모 / 소개</label>
          <Input.TextArea value={cMemo} onChange={(e) => CSetMemo(e.target.value)} rows={3} />

          <label>소유자 UID (기본값: 생성자)</label>
          <Input value={cOwn} onChange={(e) => setCOwn(e.target.value)} />

          <label>조종 권한 부여 (UID 컴마 구분)</label>
          <Input
            value={cGrants.join(',')}
            onChange={(e) => setCGrants(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
            placeholder="uid1, uid2"
          />
        </div>
      </Modal>
    </div>
  );
};
