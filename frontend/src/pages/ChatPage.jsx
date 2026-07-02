import { Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import api from '../api/axios.js';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import { PageHeader } from './pageUtils.jsx';

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const listRef = useRef(null);

  const load = async () => {
    const { data } = await api.get('chat/messages/');
    setMessages(Array.isArray(data) ? data : data.results || []);
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const send = async (event) => {
    event.preventDefault();
    if (!text.trim()) return;
    await api.post('chat/messages/', { text });
    setText('');
    await load();
  };

  return (
    <>
      <PageHeader title="Чат" />
      <section className="flex h-[calc(100vh-150px)] flex-col rounded-xl border border-slate-100 bg-white shadow-sm">
        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
          {messages.slice().reverse().map((message) => (
            <article key={message.id} className="max-w-3xl rounded-xl bg-slate-50 px-4 py-3">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-brand">{message.sender_name || `Пользователь #${message.sender}`}</span>
                <span>{new Date(message.created_at).toLocaleString('ru-RU')}</span>
              </div>
              <p className="text-sm text-slate-800">{message.text}</p>
            </article>
          ))}
        </div>
        <form onSubmit={send} className="flex gap-3 border-t border-slate-100 p-4">
          <Input className="w-full" value={text} onChange={(e) => setText(e.target.value)} placeholder="Напишите сообщение" />
          <Button type="submit">
            <Send size={17} />
            Отправить
          </Button>
        </form>
      </section>
    </>
  );
}
