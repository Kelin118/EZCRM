# EZCRM: Production-Readiness Audit

Дата: 2026-09-14. Репозиторий: Kelin118/EZCRM, master, исходный HEAD `b1d3426`.

## Audit Summary

| Категория | Результат |
| --- | --- |
| Подтверждённые группы ошибок | 28 |
| Исправлено | 28 |
| P0 / P1 / P2 | 11 / 15 / 2 |
| Потенциальные риски | 16 |
| Предложения функций | 5 |
| Новые backend-тесты | 38, включая 3 PostgreSQL concurrency tests |
| Новые frontend-тесты | 10 |
| Изменения схемы / миграции | Нет |
| Commit / push / изменение production-данных | Не выполнялись |

**Вердикт: устранены подтверждённые дефекты кода, но безусловное разрешение production-релиза не выдано.** Нужны браузерный smoke, проверка конфигурации Render и восстановление резервной копии. Не проводились полный pentest, нагрузочные испытания или исчерпывающая CRUD-матрица всех моделей. Прохождение существующих тестов не означает отсутствие ошибок в непокрытых сценариях.

Количество ошибок сгруппировано по причине, а не по числу assertion или затронутых страниц. P0 означает возможное нарушение денежных данных, истории или прав, а не установленный инцидент в production.

## Метод И Границы

Прочитаны root/backend/frontend AGENTS.md; исходный worktree был чистым. Проверены страницы, маршруты, ViewSets, serializers, модели, helpers, permissions и существующие тесты. Использованы установленные правила EZCRM design-system/browser-check и [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) как вспомогательный статический checklist. Редизайн не выполнялся.

Основные воспроизведения сделаны на изолированных тестовых данных. Для гонок поднята отдельная PostgreSQL 18 на loopback: сначала локаль C, затем отдельный кластер ICU ru-RU. Рабочая и production-базы не мигрировались и не редактировались. Тестовые базы создавались и удалялись Django test runner.

Три исходных action-обработчика дополнительно извлечены из `git show HEAD:backend/crm/views.py` через Python AST и подставлены **только в память отдельного тестового процесса**. Исходные файлы не откатывались. Barrier синхронизировал чтение старого состояния двумя запросами. Исходный код дал две выплаты, две конвертации и два успешных погашения сверх доступного остатка; исправленный код проходит те же сценарии.

## Карта И Покрытие

| Область / frontend | API, модели, последствия | Выполненная проверка |
| --- | --- | --- |
| Login, сотрудники, роли | token/refresh, users API, User; role flags, last-admin protection | serializers/views/permissions; RolePermissionTests, UserRegistrationAndEmployeeTests, RoleAccessSmokeTests; axios runtime tests |
| Clients, дубликаты, merge | clients actions; Client и перенос финансовых/учебных связей | client_duplicates, usage/delete guards, ClientPhoneDuplicateTests; нормализация телефонов, конфликт связей |
| Leads, Chat, Meta settings | leads, messaging channels, webhook; Contact, Message, Event, Trial | Meta API/webhook code, ManualLeadApiTests, MetaWebhookLeadTests, MetaEmbeddedSignupTests; внешний Meta не вызывался |
| Trials | trials, convert-to-subscription; Trial, Subscription, Finance, Lead | TrialConversionTests, новые invalid-input/split/concurrency tests |
| Subscriptions | subscriptions; CatalogItem, addons, Discount, Finance, Visit | SubscriptionEditRoundTripTests, SubscriptionDateHelperTests, DiscountApiAndSalesTests, новые snapshot/count tests |
| Master Classes | master-classes, payments, previews, bulk-create; Subject, staff, payroll, finance | MasterClassSubjectApiTests, MasterClassFinanceSyncTests, MasterClassFiltersAndDuplicateTests; новые legacy/split/scope/query tests |
| Visits / журнал | visits, lessons/attendance; остатки Subscription | LessonAttendanceJournalTests, новые rollback/ownership/delete/switch tests |
| Groups / Schedule | groups, slots, lessons, rooms, memberships | GroupScheduleTests; связи филиалов; новая проверка Lesson start/end и room |
| Products / Addon sales | catalog-items, addon-sales; item price/owner snapshots, finance | CatalogItemApiTests, AddonSaleApiTests, новые историческая цена/частичная оплата tests |
| Finance / Daily payments | finance, parts, summary, cash balance; связанные оплаты и attachments | FinanceTransactionApiTests, CashBalanceApiTests, FinanceJournalAndPaymentMethodTests, DailyPaymentsReportTests; новые atomic/history guards |
| Payroll / Worklog | payroll, employee schedules/worklog; statements, profiles, expense | PayrollWorklogApiTests, MasterClassManagerScheduleContextTests; historical schedules, boundaries, preview/persisted; новые payout/adjustment tests |
| Certificates | certificates, bulk-create, redeem, cancel, public token; batch/payment/redemptions | CertificateApiTests; новые batch snapshot, immutable nominal и concurrency tests |
| Settings / справочники | catalogs, branches, rooms, subjects, discounts, methods | SettingsReferenceSafeDeleteTests, BranchIntegrationTests, catalog owner tests; usage guards |
| Media / чеки | assets, catalog images, finance attachments, certificate assets | статический MIME/size/reference review и существующие API-тесты; не полноценный hostile-file audit |
| Search / Export / Import | global search, list filters, Excel handlers | GlobalSearchTests, legacy/display tests; новый Excel timezone test; import код проверен статически |
| Dashboard / Reports | summary querysets, branch/date, conversion, income | ReportsConversionSummaryTests, LeadFunnelReportTests, DailyPaymentsReportTests: суммы из контролируемых записей, split без double-counting |
| Audit / deployment | audit logs, settings, backup command, requirements | доступ к журналу, atomic side effects; статический config/backup review; Render и restore drill недоступны |
| Общий frontend | normalizePayload, datetime helpers, axios, формы и загрузка | Node tests реальных модулей через esbuild, Vite build; браузерные взаимодействия НЕ проверены |

## Confirmed Bugs

Все перечисленные ниже дефекты исправлены. Имена тестов без префикса находятся в [test_production_readiness.py](../backend/crm/test_production_readiness.py), frontend-тесты в [runtime.test.js](../frontend/tests/runtime.test.js).

### B01 [P0] Отказ PATCH оставлял изменённую финансовую сумму
- Area: FinanceTransaction API.
- Symptom / root cause: transaction сохранялся до проверки суммы частей, без общей atomic-транзакции.
- Reproduction: исходная сумма 100, parts 40+60; PATCH amount=120 возвращал 400, но сохранял 120.
- Fix: create/update serializer атомарны; при ошибке сумма и parts откатываются вместе.
- Regression: `test_rejected_finance_amount_patch_is_atomic`.
- Files: `backend/crm/serializers.py`, `payment_parts.py`.

### B02 [P1] Некорректная сумма части оплаты давала 500
- Area: общий payment-parts parser.
- Symptom / root cause: необработанные Decimal errors и нечисловые/нефинитные значения.
- Reproduction: `abc`, `NaN`, `Infinity`, list/object, `1e1000` в amount части.
- Fix: конечная Decimal-сумма либо DRF 400; никаких записей при отказе.
- Regression: `test_invalid_payment_part_amounts_return_400_without_writes`.
- Files: `backend/crm/payment_parts.py`.

### B03 [P1] Изменение статуса или комментария ломало смешанную оплату
- Area: Subscription, Trial, MasterClassPayment и общий sync оплат.
- Symptom / root cause: payment_method=null у split трактовался как отсутствие оплаты; unrelated PATCH пересоздавал parts.
- Reproduction: parts 40+60, затем PATCH только status/stage/comment.
- Fix: существующие parts считаются валидной оплатой; без финансового изменения сохраняются parts и исторические названия.
- Regression: `test_split_subscription_status_patch_preserves_payment`, `test_split_trial_stage_patch_preserves_payment`, `test_master_class_split_payment_comment_patch_preserves_parts`.
- Files: `backend/crm/serializers.py`, `views.py`, `payment_parts.py`.

### B04 [P0] Смена способа оплаты МК сохраняла старый способ
- Area: MasterClassPayment -> FinancePaymentPart.
- Symptom / root cause: при PATCH нового метода одна старая часть заново использовалась с прежним FK.
- Reproduction: наличные -> карта; проверить transaction, part и ответ API.
- Fix: явно переданный payment_method имеет приоритет над старой разбивкой.
- Regression: `test_master_class_payment_method_switch_uses_selected_method`, включая representation после PATCH.
- Files: `backend/crm/views.py`, `payment_parts.py`.

### B05 [P1] Custom payments обходили scope queryset и давали 500 для отсутствующего МК
- Area: master-classes/{id}/payments.
- Symptom / root cause: прямой Model.objects.get вместо scoped get_object.
- Reproduction: несуществующий parent; существующий МК с `?branch=` другого филиала.
- Fix: сначала scoped get_object/permissions, затем блокировка строки; оба случая возвращают 404.
- Regression: `test_master_class_payment_missing_parent_returns_404`, `test_master_class_payment_respects_branch_filter`.
- Files: `backend/crm/views.py`. Это исправление scope запроса, не заявление о tenant isolation всей системы.

### B06 [P0] Комментарий продажи переписывал цену и превращал частичную оплату в полную
- Area: AddonSale, catalog owner/price snapshots, Finance.
- Symptom / root cause: PATCH пересчитывал старые позиции по текущему каталогу и безусловно подставлял total в payment_amount.
- Reproduction: товар 100, оплачено 40; каталог меняется на 200 и другого владельца; PATCH comment.
- Fix: omitted items используют snapshots; metadata PATCH сохраняет paid=40, total=100 и owner. Явное изменение состава полностью оплаченной продажи сохраняет прежнее поддерживаемое поведение пересчёта оплаты.
- Regression: `test_sale_comment_does_not_reprice_or_mark_partial_sale_paid`; существующий `AddonSaleApiTests.test_edit_sale_updates_existing_finance_transaction_without_duplicate`.
- Files: `backend/crm/serializers.py`, `views.py`.

### B07 [P1] Историческая скидка блокировала unrelated PATCH
- Area: Subscription, общий расчёт скидки продаж/МК.
- Symptom / root cause: историческая скидка заново проверялась как новая активная акция; использовались текущие данные справочника.
- Reproduction: snapshot 5%, справочник 10% и inactive; PATCH status.
- Fix: неизменённая скидка использует snapshot; новая/заменённая проходит обычную проверку. Addons абонемента согласованы с существующими unit_price snapshots.
- Regression: `test_subscription_status_patch_preserves_inactive_discount_snapshot`, существующие DiscountApiAndSalesTests и round-trip tests.
- Files: `backend/crm/discounts.py`, `serializers.py`.

### B08 [P1] Новый абонемент имел неверный остаток занятий
- Area: Subscription с service.
- Symptom / root cause: remaining_visits всегда брался из service.lessons_count, игнорируя явное total_visits.
- Reproduction: service=4 занятия, total_visits=8 -> остаток 4.
- Fix: остаток нового абонемента соответствует эффективному total_visits; при смене услуги учитываются использованные занятия.
- Regression: `test_subscription_explicit_lesson_count_sets_matching_balance`.
- Files: `backend/crm/serializers.py`.

### B09 [P1] Удаление посещения не возвращало списанное занятие
- Area: Visit DELETE / Subscription balance.
- Symptom / root cause: destroy не применял уже существующее правило восстановления списания.
- Reproduction: remaining=3 из 4, lesson_deducted=true; DELETE Visit.
- Fix: восстановление и удаление атомарны, остаток читается под блокировкой.
- Regression: `test_visit_delete_restores_deducted_lesson`.
- Files: `backend/crm/views.py`.

### B10 [P0] API позволял списывать чужой абонемент и управлять служебным флагом
- Area: Visit create/PATCH.
- Symptom / root cause: нет проверки subscription.client; lesson_deducted был writable.
- Reproduction: Visit клиента A с абонементом B; либо принудительный lesson_deducted=false у уже списанного посещения.
- Fix: FK проверяется сервером, deduction flag read-only, счётчик изменяется общим locked helper.
- Regression: `test_visit_rejects_other_client_subscription`, `test_visit_deduction_flag_cannot_be_overridden`, `test_visit_subscription_switch_restores_original_and_deducts_new`.
- Files: `backend/crm/serializers.py`, `views.py`.

### B11 [P0] Ошибка второй строки посещаемости сохраняла первую
- Area: lessons/attendance.
- Symptom / root cause: return Response(400) внутри atomic не вызывает rollback; вручную выбранный абонемент не ограничивался клиентом.
- Reproduction: первая строка attended со списанием, вторая с клиентом не из группы.
- Fix: ValidationError откатывает весь batch; урок блокируется; explicit subscription выбирается только среди абонементов клиента.
- Regression: `test_attendance_invalid_second_row_rolls_back_first_row`, `test_attendance_rejects_foreign_subscription`.
- Files: `backend/crm/views.py`.

### B12 [P1] День Visit и время Excel расходились с бизнес-часовым поясом
- Area: API representation и Excel export.
- Symptom / root cause: .date()/strftime от UTC без localtime.
- Reproduction: `2026-09-13T20:30Z` должен давать 14 сентября 01:30 в Almaty.
- Fix: timezone.localdate для Visit; localtime перед экспортом aware datetime. DateField не конвертируется в UTC.
- Regression: `test_visit_date_is_business_date`, `test_export_visit_datetime_is_business_timezone`.
- Files: `backend/crm/serializers.py`, `export_excel.py`.

### B13 [P0] Прямые изменения и удаления разрывали связь продажи и денег
- Area: Finance и оплаченные parent entities.
- Symptom / root cause: SET_NULL/обычный destroy оставляли показываемую оплату без transaction либо историческую transaction без оплаченной записи; amount редактировался независимо.
- Reproduction: удалить finance оплаченного Subscription, изменить её amount или удалить оплаченный Subscription.
- Fix: связанные финансовые условия меняются через исходную карточку; прямое удаление даёт controlled conflict. Metadata можно изменять без переписывания финансовых snapshots; standalone finance сохраняет CRUD.
- Regression: `test_linked_finance_delete_does_not_leave_fictitious_payment`, `test_linked_finance_amount_cannot_diverge_from_subscription`, `test_paid_subscription_delete_preserves_history`, `test_linked_finance_full_form_can_update_comment_without_changing_payment`.
- Files: `backend/crm/views.py`. Это не система возвратов; история не удаляется автоматически.

### B14 [P1] Выплаченную зарплату можно было снова утвердить
- Area: Payroll state transitions.
- Symptom / root cause: approve не проверял исходный статус и переводил paid обратно в approved.
- Reproduction: POST approve для paid statement.
- Fix: утверждается только draft; re-read под блокировкой в approve/recalculate.
- Regression: `test_paid_payroll_cannot_be_approved_again`.
- Files: `backend/crm/views.py`.

### B15 [P1] Корректировка зарплаты не меняла итог
- Area: Payroll draft PATCH.
- Symptom / root cause: manual_adjustment сохранялся без применения расчёта.
- Reproduction: base=1000, adjustment=50 -> старый total=1000.
- Fix: draft блокируется, пересчитывается и сохраняется; total=1050 сразу в ответе.
- Regression: `test_payroll_adjustment_updates_total_immediately`.
- Files: `backend/crm/views.py`.

### B16 [P0] Выплата зарплаты могла оставить orphan expense или создать две выплаты
- Area: payroll/mark-paid -> FinanceTransaction/parts.
- Symptom / root cause: создание transaction, parts и связи не было одной locked atomic-операцией.
- Reproduction: исключение при sync parts оставляет expense; два синхронных запроса на исходном HEAD создают две transaction.
- Fix: атомарность, fresh locked statement, idempotent return для уже оплаченного; неверный метод оплаты -> 400.
- Regression: `test_payroll_payment_failure_rolls_back_transaction`, `ProductionConcurrencyTests.test_concurrent_payroll_payment_creates_one_expense`.
- Files: `backend/crm/views.py`.

### B17 [P1] Legacy МК нельзя было править; title snapshot сам менялся
- Area: MasterClass partial update.
- Symptom / root cause: subject требовался при любом PATCH; title копировался из текущего справочника независимо от смены subject.
- Reproduction: subject=null/title заполнен, PATCH stage; либо переименовать subject и изменить только stage.
- Fix: legacy читается и принимает unrelated PATCH; новый МК требует subject; snapshot обновляется при реальной смене subject.
- Regression: `test_master_class_legacy_status_patch_keeps_title`, `test_master_class_unrelated_patch_keeps_title_snapshot`.
- Files: `backend/crm/serializers.py`, `tests.py`. Прежний тест, ожидавший 400 на legacy price PATCH, обновлён согласно прямому требованию задачи, а не ради зелёного результата.

### B18 [P0] Редактирование одного сертификата уменьшало оплату всей партии
- Area: GiftCertificate -> shared batch FinanceTransaction.
- Symptom / root cause: sync записывал sale_price одной единицы в общую transaction.
- Reproduction: три сертификата по 100, общий приход 300; PATCH recipient_name одного сертификата -> приход 100.
- Fix: существующая shared transaction и её snapshots сохраняются; explicit parts проверяются против общей суммы.
- Regression: `test_certificate_batch_edit_does_not_reduce_shared_payment`.
- Files: `backend/crm/views.py`, `serializers.py`.

### B19 [P0] Номинал выпущенного сертификата менялся без согласования с остатком
- Area: GiftCertificate PATCH.
- Symptom / root cause: mutable face_value/template/условия уже выпущенного инструмента.
- Reproduction: выпустить на 100, PATCH face_value=200.
- Fix: условия выпуска immutable, для статуса используются специальные actions; данные получателя остаются редактируемыми.
- Regression: `test_certificate_cannot_change_nominal_after_issue`.
- Files: `backend/crm/serializers.py`.

### B20 [P0] Два погашения тратили больше остатка сертификата
- Area: certificates/redeem.
- Symptom / root cause: баланс проверялся до блокировки на устаревшем объекте.
- Reproduction: при балансе 100 два одновременных списания по 60 исходно отвечают 200/200; отдельный stale-object test: DB=40, объект=100, запрос=50.
- Fix: fresh locked certificate до проверки суммы и статуса, весь action atomic.
- Regression: `test_certificate_redemption_rechecks_locked_balance`, `ProductionConcurrencyTests.test_concurrent_redemptions_cannot_overspend_certificate`.
- Files: `backend/crm/views.py`.

### B21 [P1] Невалидная конвертация пробника давала 500 или сохраняла некорректные значения
- Area: trials/convert-to-subscription.
- Symptom / root cause: ручной int/Decimal/parse_date без согласованной validation.
- Reproduction: NaN/negative price, нечисловое total_visits, negative payment, 30 февраля, end<start.
- Fix: DRF Decimal/Integer/Date fields и проверка диапазона до создания записей.
- Regression: `test_trial_conversion_invalid_values_return_400`.
- Files: `backend/crm/views.py`.

### B22 [P0] Одновременная конвертация создавала два абонемента и два прихода
- Area: Trial -> Subscription/Finance/Lead.
- Symptom / root cause: проверка subscription_id вне блокировки.
- Reproduction: два запроса после одновременного чтения одного Trial: исходный HEAD отвечает 201/201.
- Fix: action atomic, Trial повторно читается select_for_update до duplicate check; результат 201/400 и одна оплата.
- Regression: `ProductionConcurrencyTests.test_concurrent_trial_conversion_creates_one_subscription`.
- Files: `backend/crm/views.py`.

### B23 [P1] Предоплата нового МК с NaN вызывала 500
- Area: MasterClass initial_payment.
- Symptom / root cause: вложенная оплата обходила существующий payment serializer.
- Reproduction: POST МК с initial_payment.amount=NaN.
- Fix: переиспользуется MasterClassPaymentSerializer, включая дату, тип, метод и parts.
- Regression: `test_master_class_initial_payment_invalid_amount_returns_400`.
- Files: `backend/crm/serializers.py`.

### B24 [P2] Lesson принимал обратный интервал и кабинет другого филиала
- Area: Lesson create/update.
- Symptom / root cause: отсутствовала проверка start<end и совместимости FK.
- Reproduction: 16:00-15:00 либо room другого branch.
- Fix: проверяются время, branch группы/слота/кабинета, соответствие slot.group.
- Regression: `test_lesson_rejects_reversed_time_and_foreign_room`.
- Files: `backend/crm/serializers.py`. Новое правило глобального запрета пересечений расписания не вводилось.

### B25 [P2] Список МК повторно запрашивал prefetched связи на каждой строке
- Area: MasterClass list serializer, payment representation.
- Symptom / root cause: participants.first и дополнительный select_related обходили prefetch cache.
- Reproduction: 1 и 6 МК: исходно 8 и 28 запросов.
- Fix: serializer использует загруженные связи; выбор первого клиента сохраняет порядок по pk.
- Regression: `test_master_class_list_queries_do_not_grow_per_client`, допустимый рост не больше двух запросов.
- Files: `backend/crm/serializers.py`, `payment_parts.py`. Остальные endpoints не объявляются свободными от N+1.

### B26 [P1] Frontend использовал часовой пояс рабочего компьютера
- Area: формы/отображение datetime, today, периоды dashboard/reports/payroll/worklog, daily navigation.
- Symptom / root cause: локальные Date getters и UTC slice смешивались с бизнес-датой; datetime-local сериализовался как время браузера.
- Reproduction: 16:00 Almaty при workstation UTC/Los Angeles; 20:30Z уже следующий бизнес-день; переход дня/месяца и историческая дата 2023 года.
- Fix: общий Intl timezone Asia/Almaty, offset даты события, календарные helper без UTC-сдвига DateField; потребители используют общие функции.
- Regression: frontend `business datetime round trip...`, `business day rolls over...`, `historical Almaty datetime...`, `calendar navigation and month bounds...`.
- Files: `frontend/src/utils/dateTime.js`, `App.jsx`, страницы из списка изменённых файлов ниже.

### B27 [P1] Параллельные 401 вызывали refresh storm
- Area: axios auth interceptor.
- Symptom / root cause: каждый запрос независимо обновлял access token.
- Reproduction: три параллельных запроса с expired token -> три refresh.
- Fix: один общий refreshPromise; опоздавшие 401 используют уже обновлённый token; retry ограничен одним разом. Ошибка сервера после retry передаётся без маскировки.
- Regression: frontend `parallel expired requests share a single token refresh`, `500 after token refresh is returned as 500 and does not clear auth`, `refresh 401/500 propagates its status and only 401 clears auth`, `retried 401 logs out without a second refresh`.
- Files: `frontend/src/api/axios.js`.

### B28 [P1] Сохранение комментария Finance заново отправляло неизменённые финансовые поля
- Area: Finance form -> normalizePayload -> linked payment guard.
- Symptom / root cause: datetime-local терял секунды; полный payload отправлял amount/parts/paid_at даже при изменении только comment. Это также конфликтовало с добавленной защитой B13.
- Reproduction: исходный paid_at=11:00:37Z, открыть форму и изменить comment; payload содержал paid_at=11:00:00Z.
- Fix: для Finance PATCH сравниваются нормализованные значения с исходной строкой; отправляются изменения. Backend допускает эквивалентный full payload, не переписывая snapshots.
- Regression: frontend `finance metadata patch omits unchanged money and minute-rounded timestamp`; backend `test_linked_finance_full_form_can_update_comment_without_changing_payment`.
- Files: `frontend/src/pages/FinancePage.jsx`, `pageUtils.jsx`, `backend/crm/views.py`.

## Potential Risks

Эти пункты не объявлены подтверждёнными production-багами и не исправлялись предположительно. Для каждого указан необходимый следующий шаг.

| ID | Что подозрительно / почему | Почему не исправлено / как подтвердить |
| --- | --- | --- |
| R01 | settings.py допускает development defaults SECRET_KEY/DEBUG; в репозитории нет Render blueprint | Production environment не доступен. Проверить реальные env, hosts, TLS/proxy/CORS, `check --deploy`, startup/migration command; не публиковать значения секретов |
| R02 | Branch filter является scope запроса, а не автоматически tenant boundary пользователя | Нельзя вводить tenant isolation без требований. Уточнить модель доступа и прогнать role x branch x action матрицу |
| R03 | Visit create и ряд writable FK требуют более широкой объектной проверки; Trial finance_transaction не read-only как у Subscription | Не проведён adversarial CRUD всех связей. Добавить тесты учителя с чужим lesson и попыток перепривязать чужую finance transaction |
| R04 | Meta event.processed_at проверяется до contact lock, unread_count увеличивается независимо от результата LeadMessage.get_or_create | Последовательная идемпотентность покрыта, concurrency webhook не воспроизведён. Нужен параллельный повтор одного event с проверкой unread_count и порядка сообщений |
| R05 | MetaWebhookView ловит processing errors и отвечает 200 | Не менять retry contract без провайдера. Проверить replay/retry после transient DB error и восстановление событий с processing_error |
| R06 | Certificate cancel не сериализован с redeem; одиночная выдача и batch имеют разную модель purchaser snapshots | Нужны cancel-vs-redeem тест и согласованный сценарий выдачи покупателю без Client. Не менять историю сертификатов автоматически |
| R07 | ReportsSummary использует created_by для income_by_managers/sales_by_manager, Finance filter использует manager | Семантика автора/ответственного неоднозначна. Dataset с разными created_by/manager и подтверждение бизнес-владельца KPI |
| R08 | Payroll: unassigned scope/branch=None, inactive payroll profile и исторические ставки требуют отдельной сверки | Графики истории покрыты, история ставок и правила распределения месячного оклада не определены. Утвердить правила, затем preview/persisted tests |
| R09 | Некоторые custom actions принимают сырые FK через filter(pk=payload), отдельные суммы не имеют одинаковых ограничений | Не выполнена полная fuzz-матрица invalid ID/type/null/negative. Проверить каждый endpoint; не подменять спорные правила оплаты общим запретом |
| R10 | Не все правила duplicate visits, active memberships и первой регистрации защищены DB constraints | Нельзя добавлять constraints без анализа существующих данных. Нужны concurrent tests и read-only диагностика дубликатов перед миграцией |
| R11 | Повторный Excel import может повторно создать бизнес-записи; импорт обрабатывает строки частично | Atomicity всего файла не заявлена текущим кодом. Проверить повтор одного файла и согласовать idempotency key/dry-run |
| R12 | SQLite backup использует копирование файла; PostgreSQL pg_dump не равен проверенному restore | Restore drill не выполнялся. Проверить консистентность активной SQLite/WAL-копии и восстановить PG backup в изолированную базу |
| R13 | Image validation проверяет MIME/размер/заголовки, но не полный decode | Не было hostile-file corpus. Проверить truncated images, неверные размеры/декодирование, заголовки download; не добавлять decoder без необходимости |
| R14 | Помимо измеренного МК остаются candidate N+1: duplicate client usage, reports per manager, certificate/finance nested data | Нет измерений на representative dataset. Снять query count/latency на 1/50/500 строк, затем локальные prefetch/aggregate fixes |
| R15 | Finance summary/cash effects имеют promises без catch; сверка кассы без saving lock | Browser runtime отсутствует, API-failure/double-click сценарии не воспроизведены. Проверить offline/500 и сохранение формы; отличать stale summary от пустых данных |
| R16 | Не проверены modal focus/restore, keyboard/touch drag, mobile overflow; JS chunk >500 kB | Статический UI review не заменяет браузер. Desktop +390px, console/network, keyboard test и замер загрузки; не делать косметический редизайн |

## Not A Bug

- Excel float используется для представления числовой ячейки, а не как источник расчёта денег в базе.
- Manual `is_extra_work` и физическое время вне графика являются разными признаками; существующие тесты сохраняют это разделение.
- Payroll schedule history и boundary cases уже реализованы; проверены существующим suite, не переписаны.
- Последовательный повтор Meta event защищён event/message identifiers; это не доказательство полной concurrency-idempotency.
- 500 после успешного refresh уже не маскировался в исходном сценарии; тест сохранён для защиты от регрессии при single-flight изменении.
- Наличие одинаковых телефонов клиентов само по себе не ошибка: система обнаруживает кандидатов и поддерживает merge, а не вводит уникальность phone.
- Отсутствие складского учёта или возвратов не является дефектом существующего CRUD.

## Possible Features / Improvements

| Функция | Problem / business value | Complexity | Dependencies |
| --- | --- | --- | --- |
| Диагностика финансовых связей read-only | Показать orphan/amount mismatch/parts mismatch без переписывания истории; подготовить безопасную сверку | Medium | Согласованные финансовые инварианты, permissions, CSV export |
| Оформленные возвраты и корректировки | Сейчас история защищена от удаления; нужен явный путь исправления ошибочной оплаты с audit trail | High | Правила возвратов, кассовый учёт, роли согласования, тесты балансов |
| Import preview и повторяемые batch keys | До записи показать дубликаты/ошибки; избежать повторного импорта файла | Medium | Формат источников, правила match/merge, хранение import batch |
| Replay failed Meta events | Возобновлять обработку transient failures без ручного редактирования БД | Medium | Идемпотентность, очередь/worker, права, безопасный payload/logging |
| Автоматизированный restore drill | Проверять восстановимость резервных копий, а не только наличие файла | Medium | Изолированная PostgreSQL, backup storage/access, расписание и уведомления |

## Verification

| Проверка | Результат |
| --- | --- |
| Baseline Django check | PASS, 0 issues |
| Baseline migrations check | PASS, No changes detected |
| Baseline Vite build | PASS, существующее предупреждение >500 kB |
| Финальный manage.py check | PASS, 0 issues |
| Финальный makemigrations --check --dry-run | PASS, No changes detected; schema changes отсутствуют |
| Focused PostgreSQL regressions | PASS, финальные 38 тестов, 4.890 s, включая Visit switch и 3 concurrency tests |
| Полный финальный crm/users, PostgreSQL 18 ICU ru-RU | PASS, 484 теста, 39.918 s; PASSWORD_HASHERS заменён на MD5 только внутри процесса тестирования через manage.py shell/call_command |
| Обычный `manage.py test crm users --noinput` со штатным hasher | PASS, 483 теста, PostgreSQL, 948.227 s. Запущен до последнего исправления/test Visit switch; финальный код отдельно проверен полным прогоном 484 tests выше и focused 38 tests |
| Frontend runtime tests | PASS, 10/10, `node --test frontend/tests/runtime.test.js` |
| Frontend build | PASS, Vite 7.3.6, 2415 modules, main JS 1136.67 kB / gzip 326.64 kB; warning >500 kB |
| Browser smoke desktop /390px | NOT RUN: in-app browser runtime вернул `Browser is not available: iab`, browsers.list()=[] |
| Browser console errors | NOT RUN: нет браузерной сессии; отсутствие ошибок не заявляется |
| Browser network errors | NOT RUN: нет браузерной сессии |
| Production smoke / Meta round-trip / backup restore / load test / vulnerability database scan | NOT RUN: не входили в выполненную локальную проверку; production/external environment не использовались |
| git diff --check | PASS, нет whitespace errors |
| git status --short | 28 modified tracked files, 3 untracked entries (тест, отчёт, frontend/tests/); ничего не staged |

Тесты SQLite не доказывают row locking. PostgreSQL concurrency tests намеренно пропускаются на SQLite и выполнены на PostgreSQL. MD5 используется только для скорости изолированного тестового runner; конфигурация хеширования приложения не изменялась.

### Не Скрытые Промежуточные Failures

1. После первого изменения AddonSale полный ускоренный suite: `AddonSaleApiTests.test_edit_sale_updates_existing_finance_transaction_without_duplicate`, ожидалось 10500, получено 5000. Это регрессия правок. Исправлен пересчёт при явной замене items полностью оплаченной продажи; существующее ожидание сохранено.
2. На временной PostgreSQL с locale C: `GlobalSearchTests.test_search_client_by_full_partial_name_and_phone` (кириллический query) и `MasterClassSubjectApiTests.test_subject_create_duplicate_filter_and_delete_rules` (201 вместо 400). Оба связаны с case conversion локали; на отдельном ICU ru-RU кластере полный suite проходит. Production collation не проверена и требует сверки.
3. Новая защита связанных finance блокировала эквивалентный full form. Воспроизведено новым тестом; backend сравнивает реальные изменения, frontend отправляет изменённые поля.
4. Locked Visit update первоначально использовал один mutable объект как before/after, теряя старый subscription. Новый test switch дал remaining=3 вместо 4; сохранение previous_subscription до save исправило регрессию.
5. Три concurrency tests с исходными обработчиками HEAD намеренно завершились failures: 2 expenses вместо 1, redeem 200/200 вместо 200/400, conversion 201/201 вместо 201/400. Исправленные обработчики проходят.

## Изменённые Файлы

- Backend: `crm/discounts.py`, `export_excel.py`, `payment_parts.py`, `serializers.py`, `views.py`: локальные проверки, snapshots, атомарность, блокировки, timezone, query reuse.
- Backend tests: новый `crm/test_production_readiness.py`, уточнённое legacy ожидание в `crm/tests.py`.
- Frontend core: `src/utils/dateTime.js`, `src/api/axios.js`, `src/pages/pageUtils.jsx`; новые `frontend/tests/runtime.test.js`.
- Frontend consumers: `App.jsx`; страницы `AuditLogsPage`, `CertificatesPage`, `ChatPage`, `ClientDetailPage`, `DailyPaymentsPage`, `DashboardPage`, `EmployeeSchedulePage`, `EmployeeWorklogPage`, `ExportPage`, `FinancePage`, `LeadsPage`, `MasterClassesPage`, `PayrollPage`, `ReportsPage`, `SettingsPage`, `TasksPage`, `TrialsPage`, `VisitsPage`. Без изменения дизайна; timezone/date defaults, Finance PATCH.
- Этот отчёт: `docs/production-readiness-audit-2026-09-14.md`.

Не изменялись модели, migrations, зависимости, production settings, payroll.py, чужие файлы, исторические бизнес-данные. Commit/push не выполнялись.

## Локальный Запуск

Frontend dev server: http://127.0.0.1:5179/ (HTTP 200 проверен, это не browser smoke).
Backend dev server: http://127.0.0.1:8000/. Для его процесса заданы DEBUG=True, localhost ALLOWED_HOSTS и CORS для порта 5179. Файлы env/settings не менялись. Первоначальный запуск с локальным окружением отказал из-за DEBUG=False и пустого ALLOWED_HOSTS; это не проверка настроек Render.
Запрос без авторизации к `/api/auth/me/` вернул ожидаемый HTTP 401. Авторизация/браузерный workflow не проверялись. Локальные dev servers оставлены для ручной проверки; временная тестовая PostgreSQL после тестов останавливается.

## Git Status --short

```text
 M backend/crm/discounts.py
 M backend/crm/export_excel.py
 M backend/crm/payment_parts.py
 M backend/crm/serializers.py
 M backend/crm/tests.py
 M backend/crm/views.py
 M frontend/src/App.jsx
 M frontend/src/api/axios.js
 M frontend/src/pages/AuditLogsPage.jsx
 M frontend/src/pages/CertificatesPage.jsx
 M frontend/src/pages/ChatPage.jsx
 M frontend/src/pages/ClientDetailPage.jsx
 M frontend/src/pages/DailyPaymentsPage.jsx
 M frontend/src/pages/DashboardPage.jsx
 M frontend/src/pages/EmployeeSchedulePage.jsx
 M frontend/src/pages/EmployeeWorklogPage.jsx
 M frontend/src/pages/ExportPage.jsx
 M frontend/src/pages/FinancePage.jsx
 M frontend/src/pages/LeadsPage.jsx
 M frontend/src/pages/MasterClassesPage.jsx
 M frontend/src/pages/PayrollPage.jsx
 M frontend/src/pages/ReportsPage.jsx
 M frontend/src/pages/SettingsPage.jsx
 M frontend/src/pages/TasksPage.jsx
 M frontend/src/pages/TrialsPage.jsx
 M frontend/src/pages/VisitsPage.jsx
 M frontend/src/pages/pageUtils.jsx
 M frontend/src/utils/dateTime.js
?? backend/crm/test_production_readiness.py
?? docs/production-readiness-audit-2026-09-14.md
?? frontend/tests/
```
