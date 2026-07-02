import { Banknote, CalendarClock, CheckSquare, CreditCard, TrendingUp, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import api from '../api/axios.js';
import StatCard from '../components/ui/StatCard.jsx';
import { money } from './pageUtils.jsx';

export default function DashboardPage() {
  const [stats, setStats] = useState({});

  useEffect(() => {
    api.get('dashboard/stats/').then(({ data }) => setStats(data));
  }, []);

  const cards = [
    ['Клиенты', stats.clients_total, Users, 'brand'],
    ['Активные абонементы', stats.active_subscriptions, CreditCard, 'green'],
    ['Абонементов заканчивается', stats.subscriptions_ending ?? stats.ending_subscriptions, CalendarClock, 'amber'],
    ['Пробники', stats.trials_total, CalendarClock, 'brand'],
    ['Пробники сегодня', stats.trials_today, CalendarClock, 'accent'],
    ['Купили', stats.trials_bought, TrendingUp, 'green'],
    ['Конверсия', `${stats.trials_conversion || 0}%`, TrendingUp, 'accent'],
    ['МК', stats.master_classes_total, CalendarClock, 'brand'],
    ['МК сегодня', stats.master_classes_today, CalendarClock, 'accent'],
    ['Посещений сегодня', stats.visits_today, CheckSquare, 'brand'],
    ['Доход сегодня', money(stats.income_today), Banknote, 'green'],
    ['Доход за месяц', money(stats.income_month), Banknote, 'green'],
    ['Доход всего', money(stats.income_total), Banknote, 'green'],
    ['Расход всего', money(stats.expense_total), Banknote, 'red'],
    ['Баланс', money(stats.balance), Banknote, 'accent'],
    ['Задачи сегодня', stats.tasks_today, CheckSquare, 'brand'],
    ['Просроченные задачи', stats.tasks_overdue, CheckSquare, 'red'],
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(([title, value, icon, tone]) => (
        <StatCard key={title} title={title} value={value} icon={icon} tone={tone} />
      ))}
    </div>
  );
}
