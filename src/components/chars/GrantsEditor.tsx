'use client';
// 회원-캐릭터 권한 편집 (3차, v1.9)
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CharGrant } from '@/lib/charStore';
import { useMembers } from '@/lib/members';
import { KInput } from '@/components/ui/Kit';
import { useConfirmDelete } from '@/components/ui/Modal';

const POP_H = 192;

export function GrantsEditor({ value = [], onChange }: {
  value?: CharGrant[];
  onChange: (next: CharGrant[]) => void;
}) {
  const members = useMembers() || [];
  const pool = members.filter(p => p.id !== 'admin');
  const del = useConfirmDelete();
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);

  const updatePos = useCallback(() => {
    if (!wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < POP_H + 10;
    setPos({
      left: r.left,
      width: r.width,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }, []);

  const openAt = () => { updatePos(); };
  const open = pos !== null;
  const setOpen = (v: boolean) => (v ? openAt() : setPos(null));

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const granted = (value || [])
    .map(g => ({ ...g, member: pool.find(p => p.id === g.userId) }))
    .filter((g): g is CharGrant & { member: NonNullable<ReturnType<typeof pool.find>> } => !!g.member);

  const matches = pool.filter(p =>
    !(value || []).some(g => g.userId === p.id) &&
    (p.nickname.toLowerCase().includes(q.trim().toLowerCase()) ||
     p.id.toLowerCase().includes(q.trim().toLowerCase()))
  );

  const setLevel = (userId: string, level: 'play' | 'edit') =>
    onChange([...(value || []).filter(g => g.userId !== userId), { userId, level }]);

  const remove = (userId: string) => onChange((value || []).filter(g => g.userId !== userId));

  return (
    <div style={{ display: 'grid', gap: 9 }}>
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <KInput
          placeholder="닉네임·아이디 검색"
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
        />
        {open && matches.length > 0 && typeof document !== 'undefined' && createPortal(
          <div
            style={{
              position: 'fixed',
              left: pos?.left ?? 0,
              width: pos?.width ?? 'auto',
              zIndex: 9999,
              ...(pos?.bottom !== undefined ? { bottom: pos.bottom } : { top: pos?.top ?? 0 }),
              background: 'var(--panel-solid, #fff)',
              border: '1px solid var(--line, #ccc)',
              borderRadius: 10,
              boxShadow: 'var(--sh-dd, 0 4px 12px rgba(0,0,0,0.15))',
              padding: 4,
              maxHeight: 180,
              overflow: 'auto',
            }}
          >
            {matches.map(p => (
              <button
                key={p.id}
                type="button"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  width: '100%',
                  textAlign: 'left',
                  padding: '7px 10px',
                  borderRadius: 7,
                  fontSize: 12.5,
                  color: 'var(--ink, #000)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  setLevel(p.id, 'play');
                  setQ('');
                  setOpen(false);
                }}
              >
                <span>{p.nickname}</span>
                <small style={{ color: 'var(--faint, #888)' }}>{p.id}</small>
              </button>
            ))}
          </div>,
          document.body
        )}
      </div>

      {granted.map(g => (
        <div key={g.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12.5 }}>
            {g.member.nickname} <small style={{ color: 'var(--faint, #888)' }}>{g.userId}</small>
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div className="mini-seg">
              <button
                type="button"
                className={g.level === 'play' ? 'on' : ''}
                onClick={() => setLevel(g.userId, 'play')}
              >
                역극 플레이
              </button>
              <button
                type="button"
                className={g.level === 'edit' ? 'on' : ''}
                onClick={() => setLevel(g.userId, 'edit')}
              >
                편집까지
              </button>
            </div>
            <span
              className="fx"
              style={{ cursor: 'pointer' }}
              data-tip="권한 해제"
              onClick={() =>
                del.ask(
                  `「${g.member.nickname}」의 권한을 해제하시겠습니까?`,
                  () => remove(g.userId),
                  '이 회원은 더 이상 이 캐릭터로 역극에 참여하거나 편집할 수 없습니다.'
                )
              }
            >
              ✕
            </span>
          </div>
        </div>
      ))}

      {granted.length === 0 && (
        <p className="hint" style={{ margin: 0, fontSize: 11, color: 'var(--faint, #888)' }}>
          권한을 준 회원이 없습니다 — 위에서 검색해 추가
        </p>
      )}

      {del.element}
    </div>
  );
}
