import { useState, useEffect } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { ArrowLeft, Plus } from 'lucide-react';

const BACKEND_URL = 'https://sizo-app.onrender.com';

type Cell = { value: string };

function App() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showModal, setShowModal] = useState(false);
  const [currentType, setCurrentType] = useState<'advocate' | 'transfer' | 'visit' | null>(null);
  const [tableData, setTableData] = useState<Cell[][]>([]);

  const dateStr = selectedDate.toISOString().split('T')[0];

  const typeNames = {
    advocate: 'Адвокаты',
    transfer: 'Передачка',
    visit: 'Свидание'
  };

  const headers = ['СИЗО 1', 'СИЗО 2', 'СИЗО 3', 'СИЗО 4', 'СИЗО 5', 'СИЗО 6', 'СИЗО 7'];

  useEffect(() => {
    if (currentType) {
      fetch(`${BACKEND_URL}/records/${dateStr}/${currentType}`)
        .then(r => r.json())
        .then((data: any[]) => {
          const newData = Array.from({ length: 15 }, (_, rowIdx) => {
            const rowCells = Array.from({ length: 7 }, (_, colIdx) => {
              const cellNum = rowIdx * 7 + colIdx + 1;
              const existing = data.find((r: any) => r.rowNum === cellNum);
              return { value: existing?.value || '' };
            });
            return rowCells;
          });
          setTableData(newData);
        });
    }
  }, [dateStr, currentType]);

  const saveCell = (rowIdx: number, colIdx: number, value: string) => {
    if (!currentType) return;
    const cellNum = rowIdx * 7 + colIdx + 1;

    fetch(`${BACKEND_URL}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        date: dateStr, 
        type: currentType, 
        rowNum: cellNum, 
        value 
      })
    });
  };

  const updateCell = (rowIdx: number, colIdx: number, value: string) => {
    const newData = [...tableData];
    newData[rowIdx][colIdx].value = value;
    setTableData(newData);
    saveCell(rowIdx, colIdx, value);
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
            className="bg-blue-600 hover:bg-blue-700 px-12 py-6 rounded-2xl text-xl font-medium flex items-center gap-3 shadow-xl"
          >
            <Plus size={32} /> Выбрать действие
          </button>
        </div>
      </div>

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
                  className="w-full py-6 bg-gray-800 hover:bg-gray-700 rounded-2xl text-xl font-medium"
                >
                  {name}
                </button>
              ))}
            </div>
            <button onClick={() => setShowModal(false)} className="mt-6 text-gray-400 w-full py-3">
              Отмена
            </button>
          </div>
        </div>
      )}

      {currentType && tableData.length > 0 && (
        <div className="px-4">
          <div className="flex items-center gap-4 mb-6">
            <button onClick={() => setCurrentType(null)} className="p-3 bg-gray-800 rounded-2xl">
              <ArrowLeft size={28} />
            </button>
            <h2 className="text-2xl font-bold">
              {typeNames[currentType]} — {selectedDate.toLocaleDateString('ru-RU')}
            </h2>
          </div>

          <div className="overflow-x-auto bg-gray-900 rounded-3xl p-4">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-800">
                  <th className="p-4 text-center w-12 text-white">#</th>
                  {headers.map((h, i) => (
                    <th key={i} className="p-4 text-center font-medium text-white border-l border-gray-700">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableData.map((row, rowIdx) => (
                  <tr key={rowIdx} className="border-t border-gray-700 hover:bg-gray-800/70">
                    <td className="p-4 text-center font-bold text-white border-r border-gray-700 bg-gray-800">
                      {rowIdx + 1}
                    </td>
                    {row.map((cell, colIdx) => (
                      <td key={colIdx} className="p-2 border-l border-gray-700">
                        <input
                          type="text"
                          value={cell.value}
                          onChange={(e) => updateCell(rowIdx, colIdx, e.target.value)}
                          className="w-full bg-[#1e2937] text-white border border-gray-600 focus:border-blue-500 rounded-xl px-4 py-3 outline-none text-base placeholder-gray-500"
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