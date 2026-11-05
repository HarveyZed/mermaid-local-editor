/* v12 语法样例集：每条都在 mermaid 12.3.0 下实测可渲染 */
export const SAMPLES = [
  {
    name: '流程图 · v12 默认（ELK + redux-color）',
    type: 'flowchart',
    code: `flowchart TD
    A[提交需求] --> B{是否合规?}
    B -->|是| C[自动生成流程图]
    B -->|否| D[转人工审核]
    D --> E{需要补充材料?}
    E -->|是| F[通知用户补充]
    F --> A
    E -->|否| C
    C --> G[发布到 Wiki]
    G --> H[通知相关团队]

    subgraph IDE[设计侧]
        I[原型设计] --> J[评审]
    end
    J --> A
`,
  },
  {
    name: '流程图 · 经典外观（还原 v11）',
    type: 'flowchart',
    code: `---
config:
  layout: dagre
  theme: default
  look: classic
---
flowchart TD
    A[提交需求] --> B{是否合规?}
    B -->|是| C[自动生成流程图]
    B -->|否| D[转人工审核]
    D --> E{需要补充材料?}
    E -->|是| F[通知用户补充]
    F --> A
    E -->|否| C
    C --> G[发布到 Wiki]
`,
  },
  {
    name: '流程图 · 子图与样式',
    type: 'flowchart',
    code: `flowchart LR
    subgraph client[客户端]
        A[Web] --> B[移动端]
    end
    subgraph server[服务端]
        C[API 网关] --> D[业务服务]
        D --> E[(数据库)]
    end
    A --> C
    B --> C

    classDef hot fill:#ffe0e0,stroke:#c0392b,stroke-width:2px
    class C,D hot
`,
  },
  {
    name: '时序图',
    type: 'sequence',
    code: `sequenceDiagram
    autonumber
    participant U as 用户
    participant G as 网关
    participant S as 订单服务
    participant D as 数据库

    U->>G: POST /orders
    G->>S: 创建订单
    S->>D: INSERT
    D-->>S: order_id
    S-->>G: 201 Created
    G-->>U: 订单号
    Note over S,D: 事务内完成
`,
  },
  {
    name: '类图',
    type: 'classDiagram',
    code: `classDiagram
    class User {
        +string id
        +string name
        +string email
        +login()
    }
    class Order {
        +string id
        +decimal amount
        +string status
    }
    class Payment {
        +string method
        +pay()
    }
    User "1" --> "*" Order : creates
    Order "1" --> "*" Payment : settled by
`,
  },
  {
    name: '状态图',
    type: 'stateDiagram',
    code: `stateDiagram-v2
    [*] --> 待付款
    待付款 --> 已付款: 支付成功
    待付款 --> 已取消: 超时
    已付款 --> 配送中: 商家发货
    配送中 --> 已完成: 确认收货
    已完成 --> [*]
`,
  },
  {
    name: '实体关系图',
    type: 'er',
    code: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ ORDER_ITEM : contains
    PRODUCT ||--o{ ORDER_ITEM : "referenced by"

    CUSTOMER {
        string id PK
        string name
        string email
    }
    ORDER {
        string id PK
        decimal amount
        string status
    }
    ORDER_ITEM {
        string id PK
        int quantity
    }
    PRODUCT {
        string id PK
        string title
    }
`,
  },
  {
    name: '甘特图',
    type: 'gantt',
    code: `gantt
    title 产品迭代计划
    dateFormat YYYY-MM-DD
    axisFormat %m/%d
    section 调研
    竞品分析      :done,    a1, 2026-01-05, 10d
    需求访谈      :active,  a2, 2026-01-12, 7d
    section 设计
    交互稿        :         b1, after a2, 8d
    视觉稿        :         b2, after b1, 5d
    section 开发
    前端          :         c1, after b2, 12d
    后端          :         c2, after b2, 12d
`,
  },
  {
    name: '思维导图',
    type: 'mindmap',
    code: `mindmap
  root((Mermaid))
    图表
      流程图
      时序图
      类图
    写法
      文本语法
      frontmatter 配置
    渲染
      dagre
      ELK
`,
  },
  {
    name: '饼图',
    type: 'pie',
    code: `pie title 时间分配
    "写代码" : 40
    "评审" : 20
    "排查问题" : 25
    "会议" : 15
`,
  },
  {
    name: '象限图',
    type: 'quadrantChart',
    code: `quadrantChart
    title 工具选型
    x-axis 低成本 --> 高成本
    y-axis 低收益 --> 高收益
    quadrant-1 值得投入
    quadrant-2 先放放
    quadrant-3 淘汰
    quadrant-4 顺手做
    Mermaid: [0.3, 0.75]
    Draw.io: [0.55, 0.6]
    Excalidraw: [0.25, 0.4]
    Visio: [0.85, 0.45]
`,
  },
  {
    name: '需求图',
    type: 'requirement',
    code: `requirementDiagram

requirement test_req {
id: 1
text: the test text.
risk: high
verifymethod: test
}

element test_entity {
type: simulation
}

test_entity - satisfies -> test_req
`,
  },
  {
    name: 'Git 分支图',
    type: 'gitGraph',
    code: `gitGraph
    commit id: "init"
    branch develop
    commit id: "feat"
    checkout main
    commit id: "release"
    merge develop
    commit id: "hotfix"
`,
  },
  {
    name: '架构图 (architecture-beta)',
    type: 'architecture',
    code: `architecture-beta
    group api(cloud)[API 层]

    service db(database)[数据库] in api
    service server(server)[业务服务] in api
    service web(browser)[Web 前端] in api

    web:L -- R:server
    server:L -- R:db
`,
  },
  {
    name: '泳道图 (swimlane-beta)',
    type: 'swimlane',
    code: `swimlane-beta LR
  subgraph 用户
    提交订单[提交订单]
    校验[校验]
  end
  subgraph 系统
    扣款[扣款]
    通知[通知]
  end
  提交订单 --> 校验
  校验 --> 扣款
  扣款 --> 通知`,
  },
  {
    name: '用例图 (usecase-beta)',
    type: 'usecase',
    code: `usecase-beta
direction LR
actor Customer("用户")
actor Admin("管理员")
systemBoundary "订单系统"
  Login("登录")
  Order("下单")
  Manage("管理商品")
end
Customer --> Login
Customer --> Order
Admin --> Manage`,
  },
  {
    name: '看板 (kanban)',
    type: 'kanban',
    code: `kanban
  todo[待办]
    id1[修复渲染兼容]@{ ticket: MC-2037, assigned: 'knsv', priority: 'High' }
  doing[进行中]
    id2[补充导出功能]
  done[完成]
    id3[上线 v1]`,
  },
  {
    name: 'XY 图表 (xychart-beta)',
    type: 'xychart',
    code: `xychart-beta
  title "月度营收"
  x-axis ["一月", "二月", "三月", "四月", "五月", "六月"]
  y-axis "营收 (万元)" 0 --> 120
  bar [32, 45, 58, 66, 92, 104]
  line [28, 40, 52, 61, 85, 99]`,
  },
  {
    name: '桑基图 (sankey-beta · 节点名暂不支持中文)',
    type: 'sankey',
    code: `sankey-beta
Coal,Power,80
Wind,Power,35
Solar,Power,25
Power,Industry,70
Power,Home,70`,
  },
  {
    name: '用户旅程图',
    type: 'journey',
    code: `journey
    title 我的工作日
    section 早上
      起床: 3: 我
      通勤: 2: 我
    section 工作中
      写代码: 5: 我
      评审: 3: 团队
    section 下班
      健身: 4: 我
`,
  },
  {
    name: '时间线',
    type: 'timeline',
    code: `timeline
    title 产品演进
    2024 : 内测 : 上线 v1
    2025 : 商业化 : 国际化
    2026 : v12 渲染器 : 全离线
`,
  },
  {
    name: '兼容演示 · 旧语法 + 已废弃配置',
    type: 'compat',
    code: `---
config:
  flowchart:
    defaultRenderer: elk
---
graph TD
    A[旧写法 graph] --> B[旧配置 defaultRenderer]
    B --> C{菱形}
    C --> D[结果]
    D --> E[缺失的 end]
`,
  },
];
