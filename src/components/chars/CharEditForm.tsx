'use client';
// 캐릭터 등록/프로필 편집 — 전용 페이지 폼 (4.4)
// 모달이 아니라 페이지라 잘못 클릭해도 닫히지 않음. 탭 내용은 별도 편집 화면으로 전환해 작성.
// 아트는 여러 장 — 첫 장이 대표 풀 아트이자 리스트 썸네일(3:4 크롭) 원본 (6.1)
import React, { useEffect, useState } from 'react';
import { Character, CharTab, ColorChip, Visibility, CharGrant } from '@/lib/charStore';
import { GrantsEditor } from '@/components/chars/GrantsEditor';
import { newId } from '@/lib/postStore';
import { putBlob, getBlob, useBlobUrl } from '@/lib/blobStore';
import { useFonts } from '@/lib/fontStore';
import { KInput, KSelect, KStep } from '@/components/ui/Kit';
import { RichEditor } from '@/components/ui/RichEditor';
import { ColorField } from '@/components/ui/ColorField';
import { CropEditor, CropValue, CropImg } from '@/components/ui/CropEditor';
import { DragList } from '@/components/ui/DragList';
import { useConfirmDelete } from '@/components/ui/Modal';
import { SymbolInput } from '@/components/ui/SymbolInput';
import { fileDrop } from '@/lib/dnd';
import { isValidSlug, slugify } from '@/lib/link';
import { useToast } from '@/components/ui/Toast';
import { Lightbox } from '@/components/ui/Lightbox';

interface SpecRow { id: string; label: string; value: string }
interface ColorRow extends ColorChip { id: string }
interface ArtItem { id: string; ref?: string; url?: string; file?: File }

function ArtThumb({ item, crop }: { item: ArtItem; crop?: CropValue }) {
  const loaded = useBlobUrl(item.ref);
  const src = item.url ?? loaded;
  if (!src) return <div className="ph" style={{ width: '100%', height: '100%' }} />;
  return <CropImg src={src} crop={crop} />;
}

export function CharEditForm({ initial, onSave, onCancel, auMode, existingIds }: {
  initial: Character | null;                // null = 신규 등록
  onSave: (c: Character) => void;
  onCancel: () => void;
  auMode?: boolean;                         // AU 전용 편집 (v1.9)
  existingIds?: string[];                   // 페이지 주소 중복 검사용 (v1.9 — 신규 등록)
}) {
  const { fonts, familyOf } = useFonts();
  const toast = useToast();
  const isNew = !initial;

  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState('');    // 페이지 주소 /chars/{slug} (v1.9 — 신규 등록, 비우면 자동)
  const [sub, setSub] = useState(initial?.sub ?? '');
  const [color, setColor] = useState(initial?.color ?? '#5d636d');
  const [themeMode, setThemeMode] = useState<'default' | 'custom'>(initial?.themeMode ?? 'default');
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? 'public');
  const [fontId, setFontId] = useState(initial?.fontId ?? 'serif');
  const [nameSize, setNameSize] = useState(initial?.nameSize ?? 38);    // 상세 큰 이름 크기 (v2.0)
  const [bodyFontId, setBodyFontId] = useState(initial?.bodyFontId ?? 'default');
  const [specs, setSpecs] = useState<SpecRow[]>(
    (initial?.specs ?? [{ label: '성별', value: '' }, { label: '키', value: '' }]).map(s => ({ ...s, id: newId() })));
  const [colors, setColors] = useState<ColorRow[]>((initial?.colors ?? []).map(c => ({ ...c, id: newId() })));
  const [colorTipMode, setColorTipMode] = useState<'hex' | 'both' | 'label'>(initial?.colorTipMode ?? 'hex');
  const [basicHtml, setBasicHtml] = useState(initial?.basicHtml ?? '');
  const [tabs, setTabs] = useState<CharTab[]>(initial?.tabs ?? []);
  const [arts, setArts] = useState<ArtItem[]>(() => {
    const refs = initial?.arts ?? (initial?.artId ? [initial.artId] : initial?.thumbId ? [initial.thumbId] : []);
    return refs.map(r => ({ id: newId(), ref: r }));
  });
  const [thumbCrop, setThumbCrop] = useState<CropValue | undefined>(initial?.thumbCrop);
  const [grants, setGrants] = useState<CharGrant[]>(initial?.grants ?? []); // 상대 캐릭터 회원 권한 (v1.9)
  const [cropOpen, setCropOpen] = useState(false);
  const [lb, setLb] = useState<number | null>(null);    // 아트 썸네일 클릭 → 원본 보기
  // 화면 전환: 메인 폼 / 탭 전용 편집 화면
  const [view, setView] = useState<'main' | string>('main');

  const addArts = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const items = Array.from(list).map(f => ({ id: newId(), url: URL.createObjectURL(f), file: f }));
    setArts(prev => {
      if (prev.length === 0) { setThumbCrop(undefined); setCropOpen(true); } // 첫 장 → 썸네일 크롭 (6.1)
      return [...prev, ...items];
    });
  };

  const save = async () => {
    if (!name.trim()) { toast('이름을 입력해 주세요'); return; }
    // 페이지 주소 (v1.9) — 유효성·중복 검사
    if (isNew && slug) {
      if (!isValidSlug(slug)) { toast('주소는 영문 소문자·숫자·하이픈만 쓸 수 있습니다'); return; }
      if (existingIds?.includes(slug)) { toast('이미 사용 중인 주소입니다 — 다른 주소를 입력해 주세요'); return; }
    }
    const artIds = await Promise.all(arts.map(a => (a.file ? putBlob(a.file) : Promise.resolve(a.ref!))));
    onSave({
      id: initial?.id ?? (slug || newId()),
      name: name.trim(),
      sub: sub.trim(),
      color,
      themeMode,
      colors: colors.filter(x => x.hex).map(({ hex, label }) => ({ hex, label })),
      colorTipMode,
      specs: specs.filter(s => s.label.trim()).map(({ label, value }) => ({ label: label.trim(), value })),
      tabs,
      basicHtml,
      visibility,
      fontId,
      nameSize,
      bodyFontId,
      thumbClass: initial?.thumbClass ?? '',
      arts: artIds,
      thumbId: artIds[0],        // 썸네일 = 첫 아트 + 크롭
      thumbCrop,
      artId: artIds[0],
      own: initial?.own ?? true,
      grants: grants.length ? grants : undefined,
    });
  };

  const rowInp: React.CSSProperties = { fontSize: 12, padding: '7px 10px' };
  const addBtn: React.CSSProperties = { padding: '5px 12px', fontSize: 11, justifySelf: 'center' };

  // 탭 삭제 — 경고 모달을 거침 (v1.9)
  const del = useConfirmDelete();
  const askDeleteTab = (tabId: string, after?: () => void) => {
    const t = tabs.find(x => x.id === tabId);
    del.ask(`탭 「${t?.title || '제목 없음'}」을 삭제하시겠습니까?`, () => {
      setTabs(l => l.filter(x => x.id !== tabId));
      after?.();
    }, '탭에 작성한 내용도 함께 사라집니다. 저장(SAVE) 전까지는 CANCEL로 폼을 벗어나면 되돌릴 수 있습니다.');
  };

  /* ---------- 탭 전용 편집 화면 ---------- */
  const curTab = tabs.find(t => t.id === view);
  if (curTab) {
    return (
      <>
        <TabEditView
          tab={curTab}
          onChange={patch => setTabs(l => l.map(x => (x.id === curTab.id ? { ...x, ...patch } : x)))}
          onDelete={() => askDeleteTab(curTab.id, () => setView('main'))}
          onBack={() => setView('main')} />
        {del.element}
      </>
    );
  }

  /* ---------- 메인 폼 ---------- */
  return (
    <div className="write-grid">
      {/* 좌: 아트/스펙/컬러/본문/탭 */}
      <div className="panel" style={{ padding: 24, display: 'grid', gap: 12, alignContent: 'start' }}>
        {/* 아트 목록 */}
        <label className="k-label" style={{ margin: 0 }}>
          아트 <span style={{ fontWeight: 400, color: 'var(--faint)' }}>— 첫 장이 대표 풀 아트 · 리스트 썸네일은 첫 장에서 3:4 크롭 · ⠿ 순서 변경</span>
        </label>
        {arts.length > 0 && (
          <DragList items={arts} keyOf={a => a.id} onReorder={setArts}
            render={(a, i) => (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', padding: '3px 0' }}>
                <span className="drag-h">⠿</span>
                <div data-tip="클릭하면 원본 보기" onClick={() => setLb(i)}
                  style={{ width: 64, aspectRatio: '3/4', borderRadius: 7, overflow: 'hidden', position: 'relative', flexShrink: 0, cursor: 'zoom-in' }}>
                  <ArtThumb item={a} crop={i === 0 ? thumbCrop : undefined} />
                </div>
                {i === 0 ? (
                  <>
                    <span className="pill dark">대표 · 썸네일</span>
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5, lineHeight: '13px' }}
                      onClick={() => setCropOpen(true)}>✂ 썸네일 크롭</button>
                  </>
                ) : (
                  <span className="pill">추가 아트</span>
                )}
                <span className="fx" style={{ marginLeft: 'auto' }}
                  onClick={() => del.ask('이 아트를 삭제하시겠습니까?', () => setArts(l => l.filter(x => x.id !== a.id)))}>✕</span>
              </div>
            )} />
        )}
        <input id="chArtsF" type="file" accept="image/*" multiple style={{ display: 'none' }}
          onChange={e => { addArts(e.target.files); e.target.value = ''; }} />
        <button className="btn btn-ghost" style={addBtn}
          onClick={() => document.getElementById('chArtsF')?.click()}
          {...fileDrop(fl => addArts(fl))}>
          ＋ ADD ART {arts.length === 0 && '(첫 장 등록 시 썸네일 크롭 지정)'}
        </button>

        {/* 기본 정보 스펙 */}
        <label className="k-label" style={{ margin: 0 }}>기본 정보 항목</label>
        <DragList items={specs} keyOf={s => s.id} onReorder={setSpecs}
          render={s => (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%', padding: '2px 0' }}>
              <span className="drag-h">⠿</span>
              <KInput placeholder="항목" value={s.label} style={{ ...rowInp, width: 90 }}
                onChange={e => setSpecs(l => l.map(x => x.id === s.id ? { ...x, label: e.target.value } : x))} />
              <KInput placeholder="값" value={s.value} style={rowInp}
                onChange={e => setSpecs(l => l.map(x => x.id === s.id ? { ...x, value: e.target.value } : x))} />
              <span className="fx" onClick={() => {
                const remove = () => setSpecs(l => l.filter(x => x.id !== s.id));
                if (s.label.trim() || s.value.trim()) del.ask('이 항목을 삭제하시겠습니까?', remove, `${s.label} — ${s.value}`);
                else remove();
              }}>✕</span>
            </div>
          )} />
        <button className="btn btn-ghost" style={addBtn}
          onClick={() => setSpecs(l => [...l, { id: newId(), label: '', value: '' }])}>＋ ADD</button>

        {/* 테마 컬러 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label className="k-label" style={{ margin: 0 }}>테마 컬러 (프로필 색 점 나열)</label>
          <div className="mini-seg" data-tip="색 점 호버 툴팁 표기 방식">
            <button className={colorTipMode === 'hex' ? 'on' : ''} onClick={() => setColorTipMode('hex')}>hex</button>
            <button className={colorTipMode === 'both' ? 'on' : ''} onClick={() => setColorTipMode('both')}>이름+hex</button>
            <button className={colorTipMode === 'label' ? 'on' : ''} onClick={() => setColorTipMode('label')}>이름만</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px' }}>
          {colors.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
              <ColorField value={c.hex} onChange={hex => setColors(l => l.map(x => x.id === c.id ? { ...x, hex } : x))} />
              <KInput placeholder="라벨" value={c.label} style={{ ...rowInp, flex: 1, minWidth: 50 }}
                onChange={e => setColors(l => l.map(x => x.id === c.id ? { ...x, label: e.target.value } : x))} />
              <span className="fx" onClick={() => del.ask('이 컬러를 삭제하시겠습니까?', () => setColors(l => l.filter(x => x.id !== c.id)), c.label || c.hex)}>✕</span>
            </div>
          ))}
        </div>
        <button className="btn btn-ghost" style={addBtn}
          onClick={() => setColors(l => [...l, { id: newId(), hex: '#888888', label: '' }])}>＋ ADD COLOR</button>

        {/* 기본 소개 본문 */}
        <label className="k-label" style={{ margin: 0 }}>기본 정보 소개 본문</label>
        <RichEditor value={basicHtml} onChange={setBasicHtml}
          placeholder="캐릭터 소개를 작성하세요 — 이미지 삽입 가능 (스크립트 불허 6.3)" />

        {/* 추가 탭 */}
        <label className="k-label" style={{ margin: 0 }}>추가 탭 — 내용은 [편집]을 눌러 전용 화면에서 작성</label>
        {tabs.map(t => (
          <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1.5px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: '#eef0f2', display: 'grid', placeItems: 'center', fontSize: 14, flexShrink: 0 }}>{t.icon}</span>
            <b style={{ fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || '(제목 없음)'}</b>
            {t.subtitle && <small style={{ color: 'var(--faint)', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subtitle}</small>}
            <small style={{ color: 'var(--faint)', fontSize: 10.5, flexShrink: 0 }}>{t.html ? `${t.html.length.toLocaleString()}자` : '비어 있음'}</small>
            <button className="btn btn-dark" style={{ marginLeft: 'auto', height: 27, padding: '0 12px', fontSize: 11 }}
              onClick={() => setView(t.id)}>편집 ›</button>
            <span className="fx" onClick={() => askDeleteTab(t.id)}>✕</span>
          </div>
        ))}
        <button className="btn btn-ghost" style={addBtn}
          onClick={() => {
            const id = newId();
            setTabs(l => [...l, { id, icon: '✦', title: '', html: '' }]);
            setView(id);
          }}>＋ ADD TAB</button>
      </div>

      {/* 우: 기본 설정 + 저장 */}
      <div>
        <div className="panel widget" style={{ marginBottom: 14 }}>
          <h4>기본</h4>
          <div style={{ display: 'grid', gap: 9 }}>
            <KInput placeholder="이름" value={name} onChange={e => setName(e.target.value)}
              style={{ fontFamily: familyOf(fontId) }} />
            
            {isNew && (
              <div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--faint)', whiteSpace: 'nowrap' }}>/chars/</span>
                  <KInput placeholder="페이지 주소 (선택)" value={slug}
                    onChange={e => setSlug(slugify(e.target.value))} style={{ flex: 1 }} />
                </div>
                {slug && existingIds?.includes(slug) && (
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--accent)' }}>이미 사용 중인 주소입니다</p>
                )}
              </div>
            )}
            
            <KInput placeholder="한 줄 소개 (선택)" value={sub} onChange={e => setSub(e.target.value)} />
            
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="cp-lb">대표 테마색</span>
              <ColorField value={color} onChange={setColor} />
            </div>
            
            <div className="mini-seg">
              <button className={themeMode === 'default' ? 'on' : ''} onClick={() => setThemeMode('default')}>기존 테마 따르기</button>
              <button className={themeMode === 'custom' ? 'on' : ''} onClick={() => setThemeMode('custom')}>캐릭터 테마색</button>
            </div>
            
            {/* 공개범위 */}
            <KSelect value={visibility} onChange={v => setVisibility(v as Visibility)}
              options={[
                { value: 'public', label: '전체공개' },
                { value: 'member', label: '멤버공개' },
                { value: 'private', label: '나만보기' },
              ]} />

            {/* 회원 권한 에디터 (우측 패널 기본 설정 영역에 무조건 노출) */}
            <div style={{ marginTop: 4 }}>
              <label className="k-label" style={{ margin: '0 0 6px' }}>회원 권한 — 역극 플레이 · 캐릭터 편집</label>
              <GrantsEditor value={grants} onChange={setGrants} />
            </div>

            <KSelect value={fontId} onChange={setFontId}
              options={fonts.map(f => ({
                value: f.id,
                label: <span style={{ fontFamily: f.family }}>{f.name}</span>,
              }))} />
            <p className="hint" style={{ margin: 0 }}>이름 폰트 — 리스트·상세 이름에 적용</p>
            
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="k-label" style={{ margin: 0, flex: 1 }}>상세 이름 크기</span>
              <KStep value={nameSize} onChange={setNameSize} min={14} max={72} step={1} suffix="px" />
            </div>
            
            <KSelect value={bodyFontId} onChange={setBodyFontId}
              options={fonts.map(f => ({
                value: f.id,
                label: <span style={{ fontFamily: f.family }}>{f.name}</span>,
              }))} />
            <p className="hint" style={{ margin: 0 }}>본문 폰트 — 프로필 정보·소개 텍스트에 적용</p>
          </div>
        </div>
        
        <div className="form-actions">
          <button className="btn btn-onbk" onClick={onCancel}>CANCEL</button>
          <button className="btn btn-accent" onClick={save}>
            {isNew ? 'ADD' : 'SAVE'}
          </button>
        </div>
      </div>

      {/* 썸네일 크롭 (3:4 — 첫 아트 기준) */}
      {arts[0] && (
        <FirstArtCrop open={cropOpen} item={arts[0]} crop={thumbCrop}
          onClose={() => setCropOpen(false)}
          onApply={c => { setThumbCrop(c); setCropOpen(false); }} />
      )}
      
      {/* 아트 원본 보기 */}
      {lb !== null && (
        <Lightbox srcs={arts.map(a => a.url ?? a.ref ?? '')} index={lb} onClose={() => setLb(null)} />
      )}
      
      {del.element}
    </div>
  );
}

/* ---------- 탭 전용 편집 화면 ---------- */
function TabEditView({ tab, onChange, onDelete, onBack }: {
  tab: CharTab;
  onChange: (patch: Partial<CharTab>) => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  return (
    <div className="panel" style={{ padding: 24, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-ghost" onClick={onBack}>‹ 돌아가기</button>
        <b style={{ fontSize: 14 }}>탭 편집</b>
        <span className="hint" style={{ margin: 0 }}>이 화면의 내용은 프로필 [SAVE] 시 함께 저장됩니다</span>
        <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={onDelete}>탭 삭제</button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <SymbolInput value={tab.icon} maxLength={2} style={{ width: 56, textAlign: 'center' }}
          onChange={v => onChange({ icon: v })} />
        <KInput placeholder="탭 제목" value={tab.title}
          onChange={e => onChange({ title: e.target.value })} />
        <KInput placeholder="소제목 (선택)" value={tab.subtitle ?? ''}
          onChange={e => onChange({ subtitle: e.target.value })} />
      </div>
      <RichEditor value={tab.html} onChange={html => onChange({ html })}
        placeholder="탭 내용을 작성하세요 — 이미지 삽입 가능 (스크립트 불허 6.3)" />
      <button className="btn btn-dark" style={{ justifySelf: 'end' }} onClick={onBack}>완료 — 목록으로</button>
    </div>
  );
}

/** 첫 아트 기준 3:4 크롭 편집기 */
function FirstArtCrop({ open, item, crop, onClose, onApply }: {
  open: boolean; item: ArtItem; crop?: CropValue;
  onClose: () => void; onApply: (c: CropValue) => void;
}) {
  const [loadedUrl, setLoadedUrl] = useState('');
  useEffect(() => {
    if (item.url || !item.ref || !open) return;
    getBlob(item.ref).then(b => { if (b) setLoadedUrl(URL.createObjectURL(b)); });
  }, [item, open]);
  const src = item.url || loadedUrl;
  if (!src || !open) return null;
  return <CropEditor open={open} src={src} aspect="3:4" initial={crop} onClose={onClose} onApply={onApply} />;
}
