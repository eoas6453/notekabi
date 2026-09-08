import { dailyTitle, toDateKey, weekdayCN } from './date'

/**
 * 笔记模板
 * ---------------------------------------------------------------
 * 只保留个人工作场景真正高频的四类 + 每日笔记，避免模板泛滥。
 * 占位符：{{date}} {{time}} {{weekday}}
 */
export interface Template {
  key: string
  name: string
  desc: string
  icon: string
  tags: string[]
  body: string
}

const fill = (s: string) => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return s
    .replace(/\{\{date\}\}/g, toDateKey(d))
    .replace(/\{\{time\}\}/g, `${pad(d.getHours())}:${pad(d.getMinutes())}`)
    .replace(/\{\{weekday\}\}/g, weekdayCN(d))
}

export const TEMPLATES: Template[] = [
  {
    key: 'daily',
    name: '每日笔记',
    desc: '按日期流水记录当天工作',
    icon: '📅',
    tags: ['日志'],
    body: `# {{date}} 星期{{weekday}}

## 今日计划
- [ ] 

## 工作记录


## 遇到问题


## 明日待办
- [ ] 

## 小结
`,
  },
  {
    key: 'worklog',
    name: '工作日志',
    desc: '记录一项具体工作的过程',
    icon: '🗒️',
    tags: ['工作', '日志'],
    body: `# 工作日志 · {{date}}

## 背景
> 为什么要做这件事

## 过程


## 结果


## 耗时与卡点


## 下次改进
`,
  },
  {
    key: 'review',
    name: '复盘模板',
    desc: '四步法做事情后复盘',
    icon: '🔍',
    tags: ['复盘'],
    body: `# 复盘 · {{date}}

## 1. 目标与预期
> 原本想达成什么

## 2. 实际结果
> 客观描述，用数据说话

## 3. 差异分析
- 做得好的：
- 没做好的：
- 根因：

## 4. 行动项
- [ ] 继续保持：
- [ ] 停止做：
- [ ] 开始做：
`,
  },
  {
    key: 'project',
    name: '项目总结',
    desc: '项目结束后的完整沉淀',
    icon: '📦',
    tags: ['项目', '总结'],
    body: `# 项目总结 · {{date}}

## 项目概览
| 项目 | 周期 | 参与角色 | 结果 |
| --- | --- | --- | --- |
|      |      |          |      |

## 目标与范围


## 关键节点
- 

## 亮点


## 不足与风险


## 沉淀的方法论


## 相关资料
`,
  },
  {
    key: 'card',
    name: '经验卡片',
    desc: '一条可复用的知识点 / 技巧',
    icon: '💡',
    tags: ['经验'],
    body: `# 经验卡片 · {{date}}

## 一句话结论


## 场景
> 什么时候会用到

## 做法
\`\`\`
步骤 / 代码
\`\`\`

## 踩坑提示


## 相关
[[ ]]
`,
  },
]

export function getTemplate(key: string): Template | undefined {
  return TEMPLATES.find((t) => t.key === key)
}

export function renderTemplate(key: string): { body: string; tags: string[] } {
  const t = getTemplate(key) || TEMPLATES[0]
  return { body: fill(t.body), tags: [...t.tags] }
}

/** 每日笔记的默认正文 */
export function dailyBody(): string {
  return fill(getTemplate('daily')!.body)
}

export function dailyTitleText(): string {
  return dailyTitle()
}
