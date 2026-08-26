import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Modal, Select, Spin, Tag, Tooltip, message as antMessage, Space } from 'antd';
import {
  UserOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  SendOutlined, LockOutlined, UnlockOutlined
} from '@ant-design/icons';
import {
  addDoc, collection, doc, onSnapshot, query, serverTimestamp, updateDoc,
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
  own?: string; // 사이트 내부 user.id 저장
  createdAt?: any;
}

export interface RpWindowProps {
  room: { id: string; title: string; hostId: string; members?: string[] };
  user: { id: string; nickname?: string }; // 사이트 내부 유저 정보
  isAdmin: boolean;
}

type MsgKind = 'player' | 'char' | 'narration' | 'dice';

interface RpMsg {
  id: string;
  roomId: string;
  kind: MsgKind;
  text: string;
  authorId: string; // 사이트 내부 user.id
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

  // 현재 활성화된 캐릭터 탭 (null이면 전체/플레이어 탭)
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
  const [cMemo, setCMemo] = useState('');
  const [cOwn, setCOwn] = useState('');
  const [cGrants, setCGrants] = useState<string[]>([]);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  // 캐릭터 목록 수신
  useEffect(() => {
    if (!room?.id) return;
    setLoadingChars(true);
    const q = query(collection(db, 'rp_characters'), where('roomId', '==', room.id));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: RpCharacter[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as RpCharacter));
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setChars(list);
        setLoadingChars(false);
      },
      (err) => {
        console.error('캐릭터 로드 에러:', err);
        setLoadingChars(false);
      }
    );
    return () => unsub();
  }, [room?.id]);

  // 메시지 목록 수신 (클라이언트 측 정렬)
  useEffect(() => {
    if (!room?.id) return;
    setLoadingMsgs(true);
    const q = query(collection(db, 'rp_messages'), where('roomId', '==', room.id));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: RpMsg[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() } as RpMsg));
        list.sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
          return tA - tB;
        });
        setRawMsgs(list);
        setLoadingMsgs(false);
      },
      (err) => {
        console.error('메시지 로드 에러:', err);
        setLoadingMsgs(false);
      }
    );
    return () => unsub();
  }, [room?.id]);

  const charMap = useMemo(() => {
    const map = new Map<string, RpCharacter>();
    chars.forEach((c) => map.set(c.id, c));
    return map;
  }, [chars]);

  // 사이트 내부 user.id 기준 캐릭터 조종 권한 체크
  const myChars = useMemo(() => {
    if (isAdmin) return chars;
    return chars.filter(
      (c) => c.own === user.id || (Array.isArray(c.grants) && c.grants.includes(user.id))
    );
  }, [chars, isAdmin, user.id]);

  // 탭 전환 시 폼 선택 캐릭터도 연동
  const handleSelectTab = (cId: string | null) => {
    setActiveCharId(cId);
    if (cId) {
      setCharId(cId);
      setKind('char');
    } else {
      setKind('player');
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [rawMsgs.length, activeCharId]);

  // 비밀글/귓속말 가시성 및 탭 필터링 (사이트 내부 user.id 기준)
  const msgsOf = (cId: string | null): RpMsg[] => {
    return rawMsgs.filter((m) => {
      // 1. 특정 캐릭터 탭에서는 해당 캐릭터 대사나 해당 캐릭터 대상 귓속말만 필터
      if (cId && m.kind === 'char' && m.charId !== cId && !m.targetCharIds?.includes(cId)) {
        return false;
      }

      // 2. 귓속말(isSecret) 표시 권한 계산 (사이트 내부 ID 사용)
      if (m.isSecret) {
        const isAuthor = m.authorId === user.id;
        const isRoomAdmin = isAdmin || room.hostId === user.id;
        
        // 내 조종 대상 캐릭터 ID 목록
        const myCharIds = myChars.map((c) => c.id);
        const isTarget = m.targetCharIds?.some((id) => myCharIds.includes(id));

        if (!isAuthor && !isRoomAdmin && !isTarget) {
          return false;
        }
      }
      return true;
    });
  };

  const handleSend = async () => {
    if (!text.trim() && kind !== 'dice') return;
    try {
      const selectedCharId = charId || activeCharId || undefined;
      let cObj = selectedCharId ? charMap.get(selectedCharId) : undefined;

      let payload: Partial<RpMsg> = {
        roomId: room.id,
        kind,
        text: text.trim(),
        authorId: user.id, // 사이트 내부 ID
        authorName: user.nickname || '익명',
        createdAt: serverTimestamp(),
      };

      if (kind === 'char') {
        if (!cObj) {
          antMessage.warning('대사할 캐릭터를 선택해주세요.');
          return;
        }
        payload.charId = cObj.id;
        payload.charName = cObj.name;
        payload.charColor = cObj.color || '#3b82f6';
        payload.charAvatar = cObj.avatarUrl || DEFAULT_AVATAR;
        payload.charOwn = cObj.own;
      }

      if (isSecret) {
        if (targetCharIds.length === 0) {
          antMessage.warning('귓속말을 받을 대상 캐릭터를 하나 이상 선택하세요.');
          return;
        }
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
      setIsSecret(false);
      setTargetCharIds([]);
      if (kind === 'dice') setKind('player');
    } catch (e) {
      console.error(e);
      antMessage.error('메시지 전송에 실패했습니다.');
    }
  };

  const handleDeleteMsg = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'rp_messages', id));
      antMessage.success('메시지가 삭제되었습니다.');
    } catch (e) {
      antMessage.error('삭제 실패');
    }
  };

  const handleUpdateMsg = async () => {
    if (!editMsgId || !editText.trim()) return;
    try {
      await updateDoc(doc(db, 'rp_messages', editMsgId), {
        text: editText.trim(),
        updatedAt: serverTimestamp(),
      });
      setEditMsgId(null);
      setEditText('');
      antMessage.success('메시지가 수정되었습니다.');
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
      setCMemo(c.memo || '');
      setCOwn(c.own || user.id);
      setCGrants(c.grants || []);
    } else {
      setCEditId(null);
      setCName('');
      setCColor('#3b82f6');
      setCAvatar('');
      setCMemo('');
      setCOwn(user.id); // 사이트 내부 ID 기본 적용
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
        own: cOwn || user.id, // 전달받은 사이트 내부 ID 적용
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
      antMessage.success('캐릭터 정보가 저장되었습니다.');
    } catch (e) {
      antMessage.error('저장 실패');
    }
  };

  const handleDeleteChar = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'rp_characters', id));
      if (activeCharId === id) setActiveCharId(null);
      antMessage.success('캐릭터가 삭제되었습니다.');
    } catch (e) {
      antMessage.error('삭제 실패');
    }
  };

  const activeChar = activeCharId ? charMap.get(activeCharId) : null;

  return (
    <div className="rp-window-container">
      {/* 탭 헤더 */}
      <div className="rp-tabs">
        <button
          className={`rp-tab-item ${activeCharId === null ? 'active' : ''}`}
          onClick={() => handleSelectTab(null)}
        >
          <UserOutlined /> 전체 / 플레이어
        </button>
        {myChars.map((c) => (
          <button
            key={c.id}
            className={`rp-tab-item ${activeCharId === c.id ? 'active' : ''}`}
            onClick={() => handleSelectTab(c.id)}
            style={{ borderBottomColor: activeCharId === c.id ? c.color : 'transparent' }}
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

      {/* 활성화된 캐릭터 상단 바 */}
      {activeChar && (
        <div className="rp-char-bar" style={{ borderLeftColor: activeChar.color || '#3b82f6' }}>
          <img className="rp-char-avatar" src={activeChar.avatarUrl || DEFAULT_AVATAR} alt="" />
          <div className="rp-char-info">
            <div className="rp-char-name">
              {activeChar.name}
              <Tag color="blue" style={{ marginLeft: 8 }}>
                {activeChar.own === user.id ? '소유자' : '조종 권한'}
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

      {/* 메시지 영역 */}
      <div className="rp-msgs">
        {loadingMsgs || loadingChars ? (
          <div className="rp-center"><Spin /></div>
        ) : msgsOf(activeCharId).length === 0 ? (
          <div className="rp-empty">대화 내역이 없습니다.</div>
        ) : (
          msgsOf(activeCharId).map((m) => {
            const isMine = m.authorId === user.id;
            const isEdit = editMsgId === m.id;

            return (
              <div
                key={m.id}
                className={`rp-msg-row ${m.kind} ${isMine ? 'me' : 'other'} ${m.isSecret ? 'secret' : ''}`}
              >
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

                  {(m.authorId === user.id || isAdmin) && !isEdit && (
                    <div className="rp-msg-hover-actions">
                      <Button icon={<EditOutlined />} type="text" size="small" onClick={() => { setEditMsgId(m.id); setEditText(m.text); }} />
                      <Button icon={<DeleteOutlined />} type="text" danger size="small" onClick={() => handleDeleteMsg(m.id)} />
                    </div>
                  )}
                </div>

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

      {/* 하단 입력 폼 */}
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
              placeholder="발신 캐릭터"
              value={charId || activeCharId || undefined}
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

          <Tooltip title="지정한 캐릭터 권한 소유자에게만 비공개">
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
              placeholder="수신 대상 캐릭터"
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
                  : '플레이어 대화를 입력하세요...'
              }
              autoSize={{ minRows: 1, maxRows: 4 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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

      {/* 캐릭터 관리 모달 */}
      <Modal
        title={cEditId ? '캐릭터 수정' : '캐릭터 추가'}
        open={cModal}
        onOk={handleSaveChar}
        onCancel={() => setCModal(false)}
        okText="저장"
        cancelText="취소"
      >
        <div className="rp-modal-form" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label>캐릭터 이름</label>
            <Input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="이름" />
          </div>

          <div>
            <label>대표 색상</label>
            <Input type="color" value={cColor} onChange={(e) => setCColor(e.target.value)} />
          </div>

          <div>
            <label>아바타 이미지 URL</label>
            <Input value={cAvatar} onChange={(e) => setCAvatar(e.target.value)} placeholder="https://..." />
          </div>

          <div>
            <label>메모 / 설정</label>
            <Input.TextArea value={cMemo} onChange={(e) => setCMemo(e.target.value)} rows={3} />
          </div>

          <div>
            <label>소유자 사이트 ID (`user.id`)</label>
            <Input value={cOwn} onChange={(e) => setCOwn(e.target.value)} placeholder="예: user_123" />
          </div>

          <div>
            <label>조종 권한 부여 (사이트 ID, 쉼표 구분)</label>
            <Input
              value={cGrants.join(', ')}
              onChange={(e) => setCGrants(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              placeholder="user_123, user_456"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};
