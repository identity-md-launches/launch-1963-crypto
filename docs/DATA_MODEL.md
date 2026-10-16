# 数据结构与计算规则（schema 1）

类型源文件：`src/model.ts`。所有金额都存为普通十进制字符串，最多 18 位小数；不使用科学计数法。`null` 表示未知，零必须明确存为 `"0"`。

## 账本

`Book` 包含 `schema: 1`、唯一 `id`、`name`、递增 `revision`、项目数组 `projects`、流水数组 `entries`、五币种 `prices`、`settings`（自动刷新和分钟间隔）、`audit`。

项目 `Project`：`id`、`name`、`category`、`account`、`related`（另一项目 ID 或 null）、`notes`、`createdAt`。关联只作标签。状态、开始日期、结束日期从有效流水计算，不额外记一笔资金。

所有流水共同字段：`id`、`date`（实际发生的本地日 YYYY-MM-DD）、`createdAt`（保存时刻，用于同日排序）、`account`、`note`、`deleted`。撤销不删除原记录。

`Money = { asset, qty }`；`HistoricalMoney = { asset, qty, price }`，其中 price 是该次发生时每枚币的 USD 单价（可空，USD 必须为 1）。`Valuation = { asset, qty: string | null }`。

## 五类流水

| kind | 专有字段 | 核心余额影响 | 收益影响 |
|---|---|---|---|
| investment | projectId, cost, recovery, release[], fee, feeTreatment, reserve, valuation, projectState | −cost +recovery −fee | 结转、历史回款价、费用、估值 |
| cash | direction, fiat, fiatAmount, usdAmount, rate, fee, payment, paymentAmount | 入金 +usdAmount；出金 −usdAmount；总是 −fee | 不属于项目收益；改变净入金 |
| exchange | from, to, fee | −from +to −fee（同一条流水） | 不改变净入金或项目收益 |
| opening | asset, qty, reason | +qty，期初非负 | 不计净入金或项目收益 |
| adjustment | asset, qty, reason | +qty，可以为负 | 不计净入金或项目收益 |

`investment` 的 cost / recovery / fee 是 HistoricalMoney 或 null。`release` 是按原始成本币种指定的结转数量，最多五项、币种不重复。`feeTreatment` 为 `cost` 或 `settlement`。计入成本的费用必须有同时发生的投入。

reserve 为 Money 或 null：非空是**更新后的项目占用总量**，null 不更新。项目同一时刻只有一个占用币种；切换币种即替换原快照。需要同时占用多个币种时建立独立子项目，用 related 关联。

valuation 为 Valuation 或 null：null 不更新；对象内 qty 为 null 是明确未知；qty 为 `"0"` 是确认零价值。估值同一时刻使用一种计价币种。它只能描述未被核心持仓记录的剩余权益，不能包含已经到账回款或仍在核心持仓的占用本金。

projectState 为 null（保持）、active（进行 / 重新打开）、closed（结束）。结束须结转全部剩余成本，自动清空估值和占用。结束项目后，新增流水须显式重新打开。

## 重算顺序与成本分配

1. 丢弃 deleted 为 true 的流水；原始数据不丢弃。
2. 按 date、createdAt、原数组顺序稳定排序。同一天先投入、后结算的导入数据应保留正确行顺序或创建时间。
3. 依流水类型增减核心余额。投资手续费只在此处扣一次；release、估值和占用不会扣余额。
4. 实际投入创建成本批次：原投入币种数量、历史 USD 本金和分配到此批的费用。未知价格使批次 USD 成本为 null。
5. 每项 release 依项目、币种先进先出消耗批次。部分批次按数量比例分摊 USD 成本与同币种费用；最后一次释放取走剩余成本，避免累计尾差。
6. 实际回款的数量立即入账。结算收益为回款历史 USD 等值，减去本条 release 的历史成本和本次结算费用。零回款也可以结转亏损；没有结转成本的回款是纯收益。
7. 应用占用、估值快照；closed 清空两者并校验全部成本已结清。
8. 用当前价格折算核心持仓、可用、占用和剩余估值，计算当前总资产与浮动盈亏。占用不再加到总资产中。

每次录入、编辑、撤销、恢复、CSV 导入都重放同一引擎。提交前阻止超额结转、缺失项目、结束后追加但未重开、结束残留成本、回款未更新估值等错误。负余额为警示而非静默修改，允许补录缺失的期初或历史流水。

历史盈亏按回收币种归属到持仓行；无回收时按结转币种或费用币种归属。浮动盈亏与估值按估值币种归属，没有估值时回退到剩余成本币种。行上的这些结果统一显示 USD，并非币种数量。

若结转本金、回款和相关费用都属于同币种，另给出币本位结果；不同币种费用无法直接相减，须使用 USD 口径。币本位结果的今日价值不替代历史已结算收益。

## 缺失值与显示

缺失价格、历史成本或估值将使对应汇总为 null，界面显示“待补充”，而非按零累计。零数量的核心资产价值数学上为零，即使尚无价格。没有成本、没有估值的纯占用项目没有额外权益，因此项目估值和浮盈均为零；明确更新为“未知估值”的项目仍显示待补充。

出入金与结算的日期筛选只影响区间指标；持仓和剩余权益一直是当前状态。当前数据会包含所有已录入的实际历史流水，禁止未来日期实际流水。当前数据不是历史资产快照。

定点数精度 10^-18；单次乘除向零截断，FIFO 最后一笔分配剩余尾差。数量原样完整展示，美元显示至分并通过 BigInt 舍入。图表百分比是展示近似值。

## 持久化与并发

个人账本存储在当前 origin 的 `shizhang.vault.v1`；上次加密副本为 `shizhang.previous.v1`。内容是 AES-256-GCM 密文封装，随机 16 字节 salt、12 字节 IV；PBKDF2-SHA256 310,000 次；密钥不可导出，口令不保存。`savedAt` 是备份时间，未暴露项目或数量。

保存顺序：生成候选账本 → 完整结构 / 账务校验 → 加密 → 检查持久化版本 → 保存上次副本 → 原子替换当前 localStorage 项 → 更新内存和界面。提供 Web Locks 的浏览器使用命名锁序列化写入，另外比较完整旧密文以拒绝过期标签。未提供 Web Locks 的旧浏览器仅使用版本比较，应避免并行编辑。

浏览器配额写入失败不会用内存成功状态覆盖界面，也不会清空表单。全量备份可恢复完整状态；审计数组保存每次流水、项目修改前后对象。恢复和导入有审计动作；完整替换时还保留替换前的加密副本。

演示数据用独立的 `shizhang.demo.v1` 保存，明文且始终有虚构标签；不与个人账本混合。加密不是云同步，服务器不存账务数据库。
