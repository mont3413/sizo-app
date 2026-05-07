import { useMemo, useRef, useState, useEffect } from 'react';
import { ArrowLeft, Plus, Loader2, ChevronLeft, ChevronRight, Image as ImageIcon, Check } from 'lucide-react';
import { format } from 'date-fns';

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ??
  (import.meta.env.PROD ? 'https://sizo-app.onrender.com' : 'http://localhost:3001');

type Cell = { value: string; resolved: boolean };

function App() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showModal, setShowModal] = useState(false);
  const [currentType, setCurrentType] = useState<'advocate' | 'transfer' | 'visit' | null>(null);
  const [currentSizo, setCurrentSizo] = useState<string | null>(null);
  const [tableData, setTableData] = useState<Cell[][]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sizoCounts, setSizoCounts] = useState<Record<string, number>>({});
  const [sizoHasImage, setSizoHasImage] = useState<Record<string, boolean>>({});
  const [sizoImageUrl, setSizoImageUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const dateStr = format(selectedDate, 'yyyy-MM-dd');

  const typeNames = {
    advocate: 'Адвокаты',
    transfer: 'Передачка',
    visit: 'Свидание'
  };

  const headers = ['СИЗО 1', 'СИЗО 2', 'СИЗО 3', 'СИЗО 4', 'СИЗО 5', 'СИЗО 6', 'СИЗО 7'];

  // Календарь
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

  const generateCalendarDays = () => {
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let day = 1; day <= daysInMonth; day++) days.push(day);
    return days;
  };

  const isSelected = (day: number) => {
    return selectedDate.getDate() === day && 
           selectedDate.getMonth() === currentMonth.getMonth() &&
           selectedDate.getFullYear() === currentMonth.getFullYear();
  };

  useEffect(() => {
    if (currentType && currentSizo) {
      setIsLoading(true);
      const url = new URL(`${BACKEND_URL}/records/${dateStr}/${currentType}`);
      url.searchParams.set('sizo', currentSizo);

      fetch(url.toString())
        .then(r => r.json())
        .then((data: any[]) => {
          const newData = Array.from({ length: 15 }, (_, rowIdx) =>
            Array.from({ length: 1 }, () => {
              const cellNum = rowIdx + 1;
              const existing = data.find((rec: any) => rec.rowNum === cellNum);
              return { value: existing?.value || '', resolved: Boolean(existing?.resolved) };
            })
          );
          setTableData(newData);
        })
        .finally(() => setIsLoading(false));
    }
  }, [dateStr, currentType, currentSizo]);

  useEffect(() => {
    if (currentType && !currentSizo) {
      fetch(`${BACKEND_URL}/sizo-summary/${dateStr}/${currentType}`)
        .then(r => r.json())
        .then((rows: Array<{ sizo: string; count: number; hasImage?: number }>) => {
          const next: Record<string, number> = {};
          const nextHasImage: Record<string, boolean> = {};
          for (const row of rows) next[row.sizo] = row.count;
          for (const row of rows) nextHasImage[row.sizo] = Boolean(row.hasImage);
          setSizoCounts(next);
          setSizoHasImage(nextHasImage);
        })
        .catch(() => {
          setSizoCounts({});
          setSizoHasImage({});
        });
    }
  }, [dateStr, currentType, currentSizo]);

  useEffect(() => {
    if (!currentType || !currentSizo) {
      if (sizoImageUrl) URL.revokeObjectURL(sizoImageUrl);
      setSizoImageUrl(null);
      return;
    }

    let cancelled = false;
    fetch(`${BACKEND_URL}/sizo-image/${dateStr}/${currentType}/${encodeURIComponent(currentSizo)}`)
      .then(async (r) => {
        if (!r.ok) return null;
        const blob = await r.blob();
        return URL.createObjectURL(blob);
      })
      .then((url) => {
        if (cancelled) return;
        if (sizoImageUrl) URL.revokeObjectURL(sizoImageUrl);
        setSizoImageUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        if (sizoImageUrl) URL.revokeObjectURL(sizoImageUrl);
        setSizoImageUrl(null);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr, currentType, currentSizo]);

  const handleImageUpload = async (file: File) => {
    if (!currentType || !currentSizo) return;
    setIsUploadingImage(true);
    try {
      const form = new FormData();
      form.append('date', dateStr);
      form.append('type', currentType);
      form.append('sizo', currentSizo);
      form.append('image', file);

      await fetch(`${BACKEND_URL}/sizo-image`, { method: 'POST', body: form });

      // refresh image
      const r = await fetch(`${BACKEND_URL}/sizo-image/${dateStr}/${currentType}/${encodeURIComponent(currentSizo)}`);
      if (r.ok) {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        if (sizoImageUrl) URL.revokeObjectURL(sizoImageUrl);
        setSizoImageUrl(url);
        setSizoHasImage((curr) => ({ ...curr, [currentSizo]: true }));
      }
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleDeleteImage = async () => {
    if (!currentType || !currentSizo) return;
    setIsUploadingImage(true);
    try {
      await fetch(
        `${BACKEND_URL}/sizo-image/${dateStr}/${currentType}/${encodeURIComponent(currentSizo)}`,
        { method: 'DELETE' }
      );
      if (sizoImageUrl) URL.revokeObjectURL(sizoImageUrl);
      setSizoImageUrl(null);
      setSizoHasImage((curr) => ({ ...curr, [currentSizo]: false }));
    } finally {
      setIsUploadingImage(false);
    }
  };

  const fileInputId = useMemo(() => `sizo-image-${dateStr}-${currentType ?? 'none'}-${currentSizo ?? 'none'}`, [dateStr, currentType, currentSizo]);

  const saveTimersRef = useRef<Record<number, number | undefined>>({});
  const pendingSavesRef = useRef<Record<number, { value: string; resolved: boolean }>>({});
  const imageLongPressTimerRef = useRef<number | null>(null);
  const imageLongPressActiveRef = useRef(false);

  const handleSaveImage = async () => {
    if (!sizoImageUrl) return;

    // iOS/Telegram WebView often ignores <a download>. Web Share works more reliably.
    try {
      if (navigator.share) {
        const blob = await fetch(sizoImageUrl).then((r) => r.blob());
        const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
        const name = `sizo-${dateStr}-${currentType ?? 'type'}-${currentSizo ?? 'sizo'}.${ext}`;
        const file = new File([blob], name, { type: blob.type || 'image/jpeg' });

        const canShareFiles =
          typeof (navigator as any).canShare === 'function' ? (navigator as any).canShare({ files: [file] }) : true;

        if (canShareFiles) {
          await navigator.share({ files: [file], title: name });
          return;
        }
      }
    } catch {
      // ignore and fallback
    }

    // Fallback: open image itself (user can long-press or use browser UI)
    window.open(sizoImageUrl, '_blank', 'noopener,noreferrer');
  };

  const saveCellNow = (rowIdx: number, value: string, resolved: boolean) => {
    if (!currentType || !currentSizo) return;
    const cellNum = rowIdx + 1;
    fetch(`${BACKEND_URL}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // keepalive helps ensure the last save is sent even if user navigates away quickly
      keepalive: true,
      body: JSON.stringify({ date: dateStr, type: currentType, sizo: currentSizo, rowNum: cellNum, value, resolved })
    });
  };

  const scheduleSave = (rowIdx: number, value: string, resolved: boolean) => {
    pendingSavesRef.current[rowIdx] = { value, resolved };
    const existing = saveTimersRef.current[rowIdx];
    if (existing) window.clearTimeout(existing);
    saveTimersRef.current[rowIdx] = window.setTimeout(() => {
      const pending = pendingSavesRef.current[rowIdx];
      if (!pending) return;
      delete pendingSavesRef.current[rowIdx];
      saveCellNow(rowIdx, pending.value, pending.resolved);
    }, 400);
  };

  const flushPendingSaves = () => {
    const entries = Object.entries(pendingSavesRef.current);
    if (!entries.length) return;
    for (const [k, v] of entries) {
      const rowIdx = Number(k);
      const t = saveTimersRef.current[rowIdx];
      if (t) window.clearTimeout(t);
      saveCellNow(rowIdx, v.value, v.resolved);
      delete pendingSavesRef.current[rowIdx];
    }
  };

  useEffect(() => {
    return () => {
      flushPendingSaves();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr, currentType, currentSizo]);

  const updateCell = (rowIdx: number, value: string) => {
    const newData = [...tableData];
    const prev = newData[rowIdx][0].value ?? '';
    newData[rowIdx][0].value = value;
    setTableData(newData);
    scheduleSave(rowIdx, value, newData[rowIdx][0].resolved);

    if (currentSizo) {
      const prevFilled = prev.trim().length > 0;
      const nextFilled = value.trim().length > 0;
      if (prevFilled !== nextFilled) {
        setSizoCounts((curr) => {
          const currentCount = curr[currentSizo] ?? 0;
          const nextCount = Math.max(0, currentCount + (nextFilled ? 1 : -1));
          return { ...curr, [currentSizo]: nextCount };
        });
      }
    }
  };

  const toggleResolved = (rowIdx: number) => {
    const newData = [...tableData];
    const current = newData[rowIdx][0];
    current.resolved = !current.resolved;
    setTableData(newData);
    // status change should persist quickly
    scheduleSave(rowIdx, current.value, current.resolved);
  };

  return (
    <div className="min-h-screen bg-black text-white pb-20">
      {isImageViewerOpen && sizoImageUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 p-4 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          onPointerDown={() => {
            imageLongPressActiveRef.current = false;
            if (imageLongPressTimerRef.current) window.clearTimeout(imageLongPressTimerRef.current);
            imageLongPressTimerRef.current = window.setTimeout(() => {
              imageLongPressActiveRef.current = true;
            }, 350);
          }}
          onPointerUp={() => {
            if (imageLongPressTimerRef.current) window.clearTimeout(imageLongPressTimerRef.current);
            imageLongPressTimerRef.current = null;
          }}
          onPointerCancel={() => {
            if (imageLongPressTimerRef.current) window.clearTimeout(imageLongPressTimerRef.current);
            imageLongPressTimerRef.current = null;
          }}
          onClick={() => {
            // If user long-pressed to open iOS image menu, ignore the click that can fire after release.
            if (imageLongPressActiveRef.current) return;
            setIsImageViewerOpen(false);
          }}
        >
          <div className="relative max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-end mb-3">
              <button
                type="button"
                className="inline-flex items-center justify-center px-4 py-2 rounded-2xl font-bold bg-zinc-800 hover:bg-zinc-700 text-white"
                onClick={handleSaveImage}
              >
                Сохранить
              </button>
            </div>
            <img
              src={sizoImageUrl}
              alt="Фото СИЗО (просмотр)"
              className="w-full max-h-[80vh] object-contain rounded-3xl border border-zinc-700 bg-black"
            />
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto p-4">
        <h1 className="text-4xl font-bold text-center mb-8 text-white">📅 Запись в СИЗО</h1>

        {/* Календарь */}
        <div className="bg-zinc-950 rounded-3xl p-6 mb-8 border border-zinc-700">
          <div className="flex items-center justify-between mb-6">
            <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))} className="p-3">
              <ChevronLeft size={28} />
            </button>
            <h2 className="text-2xl font-bold">
              {currentMonth.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })}
            </h2>
            <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))} className="p-3">
              <ChevronRight size={28} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => (
              <div key={day} className="text-zinc-400 font-medium py-2">{day}</div>
            ))}
            {generateCalendarDays().map((day, index) => (
              day ? (
                <button
                  key={index}
                  onClick={() => setSelectedDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day))}
                  className={`h-12 flex items-center justify-center rounded-2xl text-lg font-medium transition-all
                    ${isSelected(day) ? 'bg-blue-600 text-white' : 'hover:bg-zinc-800 text-white'}`}
                >
                  {day}
                </button>
              ) : <div key={index} className="h-12"></div>
            ))}
          </div>
        </div>

        <div className="flex justify-center mb-10">
          <button
            onClick={() => setShowModal(true)}
            className="bg-blue-600 hover:bg-blue-700 px-16 py-7 rounded-2xl text-2xl font-bold flex items-center gap-3"
          >
            <Plus size={36} /> Выбрать действие
          </button>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-950 rounded-3xl p-8 w-full max-w-sm border border-zinc-700">
            <h2 className="text-2xl font-bold text-center mb-8 text-white">
              {selectedDate.toLocaleDateString('ru-RU')}
            </h2>
            <div className="space-y-4">
              {Object.entries(typeNames).map(([key, name]) => (
                <button
                  key={key}
                  onClick={() => {
                    setCurrentType(key as any);
                    setCurrentSizo(null);
                    setTableData([]);
                    setSizoCounts({});
                    setSizoHasImage({});
                    setShowModal(false);
                  }}
                  className="w-full py-7 bg-zinc-900 hover:bg-zinc-800 rounded-2xl text-xl font-medium text-white"
                >
                  {name}
                </button>
              ))}
            </div>
            <button onClick={() => setShowModal(false)} className="mt-6 text-zinc-400 w-full py-3">
              Отмена
            </button>
          </div>
        </div>
      )}

      {currentType && (
        <div className="px-4">
          <div className="flex items-center gap-4 mb-6 sticky top-0 bg-black py-3 z-40">
            <button
              onClick={() => {
                flushPendingSaves();
                if (currentSizo) {
                  setCurrentSizo(null);
                  setTableData([]);
                } else {
                  setCurrentType(null);
                  setTableData([]);
                }
              }}
              className="p-3 bg-zinc-900 rounded-2xl"
            >
              <ArrowLeft size={28} />
            </button>
            <h2 className="text-2xl font-bold text-white">
              {typeNames[currentType]} — {selectedDate.toLocaleDateString('ru-RU')}
              {currentSizo ? ` — ${currentSizo}` : ''}
            </h2>
          </div>

          {!currentSizo ? (
            <div className="bg-zinc-950 rounded-3xl p-4 border border-zinc-700">
              <div className="space-y-2">
                {headers.map((h) => (
                  <button
                    key={h}
                    onClick={() => setCurrentSizo(h)}
                    className="w-full bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-700 
                               rounded-2xl border border-zinc-700 hover:border-zinc-600 
                               transition-all px-4 h-14"
                  >
                    <div className="flex items-center justify-between gap-3 h-full">
                      <div className="text-[14px] font-semibold text-white truncate">
                        {h}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {(sizoCounts[h] ?? 0) > 0 && (
                          <div className="min-w-[2.25rem] h-8 bg-blue-600 text-white text-[13px] font-bold 
                                          rounded-2xl flex items-center justify-center px-3">
                            {sizoCounts[h]}
                          </div>
                        )}

                        {sizoHasImage[h] && (
                          <div
                            className="w-8 h-8 rounded-2xl bg-zinc-800 flex items-center justify-center border border-zinc-600"
                            aria-label="Есть фото"
                            title="Есть фото"
                          >
                            <ImageIcon size={18} className="text-zinc-300" />
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 size={48} className="animate-spin text-blue-500" />
            </div>
          ) : (
            <div className="bg-zinc-950 rounded-3xl border border-zinc-700">
              <div className="p-4 border-b border-zinc-800">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    {sizoImageUrl ? (
                      <img
                        src={sizoImageUrl}
                        alt="Фото СИЗО"
                        className="w-full max-h-72 object-contain rounded-2xl border border-zinc-700 bg-black hover:border-zinc-500 transition-colors cursor-pointer"
                        onClick={() => setIsImageViewerOpen(true)}
                      />
                    ) : (
                      <div className="w-full h-40 rounded-2xl border border-zinc-700 bg-zinc-900 flex items-center justify-center text-zinc-400">
                        Фото не добавлено
                      </div>
                    )}
                  </div>

                  <div className="shrink-0">
                    <input
                      id={fileInputId}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageUpload(file);
                        e.currentTarget.value = '';
                      }}
                    />
                    <label
                      htmlFor={fileInputId}
                      className={`w-full inline-flex items-center justify-center px-4 py-3 rounded-2xl font-bold text-white cursor-pointer ${
                        isUploadingImage ? 'bg-zinc-700' : 'bg-blue-600 hover:bg-blue-700'
                      }`}
                    >
                      {isUploadingImage ? 'Загрузка…' : sizoImageUrl ? 'Заменить' : 'Добавить'}
                    </label>

                    {sizoImageUrl && (
                      <div className="mt-3 space-y-3">
                        <button
                          type="button"
                          disabled={isUploadingImage}
                          onClick={handleDeleteImage}
                          className={`w-full inline-flex items-center justify-center px-4 py-3 rounded-2xl font-bold text-white ${
                            isUploadingImage ? 'bg-zinc-700' : 'bg-red-600 hover:bg-red-700'
                          }`}
                        >
                          Удалить
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="bg-zinc-900">
                    <th className="p-4 text-center w-14 text-white font-bold bg-zinc-900 z-10 text-sm">
                      #
                    </th>
                    <th className="p-4 text-center text-white font-bold text-sm">
                      {currentSizo}
                    </th>
                    <th className="p-4 text-center w-16 text-white font-bold text-sm">
                      ✓
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, rowIdx) => (
                    <tr key={rowIdx} className="border-t border-zinc-800 hover:bg-zinc-900">
                      <td className="px-3 py-2 text-center font-bold text-white bg-zinc-900 z-10 text-xs">
                        {rowIdx + 1}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          value={row[0]?.value ?? ''}
                          onChange={(e) => updateCell(rowIdx, e.target.value)}
                          onBlur={() => {
                            const cell = tableData[rowIdx]?.[0];
                            if (cell) saveCellNow(rowIdx, cell.value, cell.resolved);
                          }}
                          className="w-full bg-zinc-950 text-white border border-zinc-600 focus:border-blue-500 
                                     rounded-2xl px-3 py-2 text-[16px] leading-tight min-h-[40px]"
                        />
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => toggleResolved(rowIdx)}
                          className={`inline-flex items-center justify-center w-10 h-10 rounded-2xl border ${
                            row[0]?.resolved ? 'bg-green-600 border-green-500' : 'bg-zinc-900 border-zinc-700'
                          }`}
                          aria-label={row[0]?.resolved ? 'Отменить галочку' : 'Поставить галочку'}
                        >
                          <Check size={20} className={row[0]?.resolved ? 'text-white' : 'text-transparent'} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;