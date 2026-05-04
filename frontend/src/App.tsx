import { useState, useEffect } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { ArrowLeft, Plus } from 'lucide-react';

type Record = { rowNum: number; value: string };

const BACKEND_URL = 'https://sizo-app.onrender.com';   // ← твой бэкенд

function App() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showModal, setShowModal] = useState(false);
  const [currentType, setCurrentType] = useState<'advocate' | 'transfer' | 'visit' | null>(null);
  const [records, setRecords] = useState<Record[]>([]);

  const dateStr = selectedDate.toISOString().split('T')[0];

  const typeNames = {
    advocate: 'Адвокаты',
    transfer: 'Передачка',
    visit: 'Свидание'
  };

  const headers = ['СИЗО 1', 'СИЗО 2', 'СИЗО 3', 'СИЗО 4', 'СИЗО 5', 'СИЗО 6', 'СИЗО 7'];

  // Загрузка записей
  useEffect(() => {
    if (currentType) {
      fetch(`${BACKEND_URL}/records/${dateStr}/${currentType}`)
        .then(r => r.json())
        .then(data => {
          const arr = Array.from({ length: 15 }, (_, i) => {
            const rowNum = i + 1;
            const existing = data.find((r: any) => r.rowNum === rowNum);
            return { rowNum, value: existing?.value || '' };
          });
          setRecords(arr);
        })
        .catch(err => console.error('Ошибка загрузки:', err));
    }
  }, [dateStr, currentType]);

  const saveRecord = (rowNum: number, value: string) => {
    if (!currentType) return;
    
    fetch(`${BACKEND_URL}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        date: dateStr, 
        type: currentType, 
        rowNum, 
        value 
      })
    }).catch(err => console.error('Ошибка сохранения:', err));
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white pb-20">
      <div className="max-w-4xl mx-auto p-4">
        <h1 className="text-3xl font-bold text-center mb-8">📅 Запись в СИЗО</h1>

        <div className="bg-gray-900 rounded-3xl p-6 mb-8">
          <Calendar
            onChange={(val: any) => {
              setSelectedDate(val);
              setCurrentType(null);
            }}
            value={selectedDate}
          />
        </div>

        <div className="flex justify-center">
          <button
            onClick={() => setShowModal(true)}
            className="bg-blue-600 hover:bg-blue-700 px-12 py-6 rounded-2xl text-xl font-medium flex items-center gap-3 shadow-xl active:scale-95 transition-transform"
          >
            <Plus size={32} /> Выбрать действие
          </button>
        </div>
      </div>

      {/* Модальное окно выбора */}
      {showModal && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-3xl p-8 w-full max-w-sm">
            <h2 className="text-2xl font-bold text-center mb-6">
              {selectedDate.toLocaleDateString('ru-RU')}
            </h2>
            <div className="space-y-3">
              {Object.entries(typeNames).map(([key, name]) => (
                <button
                  key={key}
                  onClick={() => { setCurrentType(key as any); setShowModal(false); }}
                  className="w-full py-6 bg-gray-800 hover:bg-gray-700 rounded-2xl text-xl font-medium active:bg-gray-600 transition"
                >
                  {name}
                </button>
              ))}
            </div>
            <button 
              onClick={() => setShowModal(false)} 
              className="mt-6 text-gray-400 w-full py-3 hover:text-white transition"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Таблица */}
      {currentType && (
        <div className="px-4">
          <div className="flex items-center gap-4 mb-6">
            <button 
              onClick={() => setCurrentType(null)}
              className="p-3 bg-gray-800 rounded-2xl hover:bg-gray-700"
            >
              <ArrowLeft size={28} />
            </button>
            <h2 className="text-2xl font-bold">
              {typeNames[currentType]} — {selectedDate.toLocaleDateString('ru-RU')}
            </h2>
          </div>

          <div className="overflow-x-auto bg-gray-900 rounded-3xl p-4">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-800">
                  <th className="p-4 text-center">#</th>
                  {headers.map((h, i) => (
                    <th key={i} className="p-4 text-center font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((row, idx) => (
                  <tr key={idx} className="border-t border-gray-700 hover:bg-gray-800/50">
                    <td className="p-4 text-center font-bold">{idx + 1}</td>
                    {Array.from({ length: 7 }).map((_, col) => (
                      <td key={col} className="p-2">
                        <input
                          type="text"
                          value={row.value}
                          onChange={(e) => {
                            const newRecords = [...records];
                            newRecords[idx].value = e.target.value;
                            setRecords(newRecords);
                            saveRecord(idx + 1, e.target.value);
                          }}
                          className="w-full bg-gray-950 border border-gray-600 focus:border-blue-500 rounded-xl px-4 py-3 outline-none text-base"
                          placeholder="ФИО / данные..."
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;