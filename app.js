// Slack ToDoリストアプリ

// 必要なパッケージ
// package.json
/*
{
  "name": "slack-todo-app",
  "version": "1.0.0",
  "description": "Slack上で動作するToDoリストアプリ",
  "main": "app.js",
  "scripts": {
    "start": "node app.js"
  },
  "dependencies": {
    "@slack/bolt": "^3.13.1",
    "dotenv": "^16.0.3",
    "mongoose": "^7.0.3"
  }
}
*/

// .env ファイル
/*
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token
MONGODB_URI=mongodb://localhost:27017/slack-todo
PORT=3000
*/

// 開発環境でのみdotenvを読み込む（本番環境では不要）
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (err) {
    console.log('dotenv not found, using environment variables');
  }
}

const { App } = require('@slack/bolt');

// 接続タイムアウトの設定を調整
const { MongoClient } = require('mongodb');

const mongoclient = new MongoClient(process.env.MONGODB_URI, {
  connectTimeoutMS: 30000,    // 接続タイムアウト（デフォルト: 10秒）
  socketTimeoutMS: 45000,     // ソケットタイムアウト（デフォルト: 0）
  serverSelectionTimeoutMS: 30000, // サーバー選択タイムアウト
  maxPoolSize: 10,            // 接続プールの最大サイズ
  minPoolSize: 2,             // 接続プールの最小サイズ
  retryWrites: true,          // 書き込み再試行
  w: 'majority'               // 書き込み確認レベル
});

// 接続を使い回す（推奨）
let db;

async function connectDB() {
  if (!db) {
    try {
      await client.connect();
      db = client.db('your-database-name');
      console.log('MongoDB connected successfully');
    } catch (error) {
      console.error('MongoDB connection failed:', error);
      throw error;
    }
  }
  return db;
}

// 使用例
async function insertTodo(todoData) {
  try {
    const database = await connectDB();
    const collection = database.collection('todos');
    
    const result = await collection.insertOne(todoData);
    return result;
  } catch (error) {
    console.error('Insert todo failed:', error);
    throw error;
  }
}

// ToDo追加コマンド
app.command('/todo', async ({ command, ack, respond }) => {
  await ack();
  
  try {
    const todoData = {
      userId: command.user_id,
      text: command.text,
      completed: false,
      createdAt: new Date()
    };
    
    // タイムアウト対策を施した挿入処理
    const result = await insertTodoWithRetry(todoData);
    
    await respond({
      text: `✅ ToDo「${command.text}」を追加しました！`,
      response_type: 'ephemeral'
    });
    
  } catch (error) {
    console.error('ToDo追加エラー:', error);
    
    await respond({
      text: '❌ ToDoの追加に失敗しました。しばらく待ってから再試行してください。',
      response_type: 'ephemeral'
    });
  }
});


const mongoose = require('mongoose');
const express = require('express');

// MongoDB接続
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB 接続エラー:', err));


// ToDoスキーマとモデル
const todoSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true
  },
  completed: {
    type: Boolean,
    default: false
  },
  userId: {
    type: String,
    required: true
  },
  userName: {
    type: String,
    required: true
  },
  channelId: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Todo = mongoose.model('Todo', todoSchema);

// Slackアプリの初期化
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 10000
});

// タイムアウト処理を追加
async function insertTodoWithTimeout(todoData, timeoutMs = 10000) {
  return Promise.race([
    insertTodo(todoData),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
    )
  ]);
}

// リトライ機能付き
async function insertTodoWithRetry(todoData, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await insertTodo(todoData);
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // 指数バックオフ
      await new Promise(resolve => 
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      );
    }
  }
}

// ヘルプメッセージ
const helpMessage = `
*ToDoリストアプリの使い方*:
• \`/todo help\` - このヘルプメッセージを表示
• \`/todo add タスク内容\` - 新しいタスクを追加
• \`/todo list\` - タスク一覧を表示
• \`/todo complete タスクID\` - タスクを完了としてマーク
• \`/todo uncomplete タスクID\` - タスクを未完了としてマーク
• \`/todo delete タスクID\` - タスクを削除
• \`/todo clear\` - 完了したタスクをすべて削除
`;

// /todo コマンドのハンドラー
app.command('/todo', async ({ command, ack, respond }) => {
  // コマンド受信確認
  await ack();

  const { text, user_id, user_name, channel_id } = command;
  const args = text.split(' ');
  const subCommand = args[0].toLowerCase();

  // サブコマンドの処理
  switch (subCommand) {
    case 'help':
      await respond(helpMessage);
      break;

    case 'add':
      if (args.length < 2) {
        await respond('タスク内容を入力してください。例: `/todo add 会議資料の準備`');
        return;
      }
      
      const taskText = args.slice(1).join(' ');
      const newTodo = new Todo({
        text: taskText,
        userId: user_id,
        userName: user_name,
        channelId: channel_id
      });
      
      await newTodo.save();
      await respond(`タスク「${taskText}」を追加しました。`);
      break;

    case 'list':
      const todos = await Todo.find({ channelId: channel_id }).sort('createdAt');
      
      if (todos.length === 0) {
        await respond('このチャンネルにはタスクがありません。');
        return;
      }
      
      let message = '*ToDoリスト*:\n';
      todos.forEach(todo => {
        const status = todo.completed ? '✅' : '⬜';
        message += `${status} *ID:* ${todo._id} - ${todo.text} (@${todo.userName})\n`;
      });
      
      await respond(message);
      break;

    case 'complete':
      if (args.length < 2) {
        await respond('タスクIDを指定してください。例: `/todo complete 5f8d0e5e1c91c7353c6b4d7a`');
        return;
      }
      
      const completeId = args[1];
      const todoToComplete = await Todo.findById(completeId);
      
      if (!todoToComplete) {
        await respond(`ID: ${completeId} のタスクが見つかりません。`);
        return;
      }
      
      todoToComplete.completed = true;
      await todoToComplete.save();
      await respond(`タスク「${todoToComplete.text}」を完了としてマークしました。`);
      break;

    case 'uncomplete':
      if (args.length < 2) {
        await respond('タスクIDを指定してください。例: `/todo uncomplete 5f8d0e5e1c91c7353c6b4d7a`');
        return;
      }
      
      const uncompleteId = args[1];
      const todoToUncomplete = await Todo.findById(uncompleteId);
      
      if (!todoToUncomplete) {
        await respond(`ID: ${uncompleteId} のタスクが見つかりません。`);
        return;
      }
      
      todoToUncomplete.completed = false;
      await todoToUncomplete.save();
      await respond(`タスク「${todoToUncomplete.text}」を未完了としてマークしました。`);
      break;

    case 'delete':
      if (args.length < 2) {
        await respond('タスクIDを指定してください。例: `/todo delete 5f8d0e5e1c91c7353c6b4d7a`');
        return;
      }
      
      const deleteId = args[1];
      const todoToDelete = await Todo.findById(deleteId);
      
      if (!todoToDelete) {
        await respond(`ID: ${deleteId} のタスクが見つかりません。`);
        return;
      }
      
      await Todo.findByIdAndDelete(deleteId);
      await respond(`タスク「${todoToDelete.text}」を削除しました。`);
      break;

    case 'clear':
      const result = await Todo.deleteMany({ 
        channelId: channel_id,
        completed: true 
      });
      
      await respond(`完了済みのタスク ${result.deletedCount} 件を削除しました。`);
      break;

    default:
      await respond(`不明なコマンドです: \`${subCommand}\`\n${helpMessage}`);
  }
});

// ホームタブアプリの設定 - ユーザーごとのタスク管理UI
app.event('app_home_opened', async ({ event, client }) => {
  try {
    // ユーザーのタスクを取得
    const userTodos = await Todo.find({ userId: event.user }).sort('createdAt');
    
    // ブロックを構築
    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "あなたの ToDoリスト",
          emoji: true
        }
      },
      {
        type: "divider"
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "タスクの追加、管理、完了をここで行えます。"
        }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "新しいタスクを追加",
              emoji: true
            },
            action_id: "add_todo"
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "完了したタスクをクリア",
              emoji: true
            },
            action_id: "clear_completed"
          }
        ]
      },
      {
        type: "divider"
      }
    ];

    // タスクリスト部分のブロックを作成
    if (userTodos.length === 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "タスクはありません。新しいタスクを追加しましょう！"
        }
      });
    } else {
      // アクティブなタスク
      const activeTodos = userTodos.filter(todo => !todo.completed);
      if (activeTodos.length > 0) {
        blocks.push({
          type: "header",
          text: {
            type: "plain_text",
            text: "未完了のタスク",
            emoji: true
          }
        });

        activeTodos.forEach(todo => {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `• ${todo.text}`
            },
            accessory: {
              type: "button",
              text: {
                type: "plain_text",
                text: "完了",
                emoji: true
              },
              value: todo._id.toString(),
              action_id: "complete_todo"
            }
          });
        });
      }

      // 完了したタスク
      const completedTodos = userTodos.filter(todo => todo.completed);
      if (completedTodos.length > 0) {
        blocks.push({
          type: "header",
          text: {
            type: "plain_text",
            text: "完了したタスク",
            emoji: true
          }
        });

        completedTodos.forEach(todo => {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `~${todo.text}~`
            },
            accessory: {
              type: "button",
              text: {
                type: "plain_text",
                text: "削除",
                emoji: true
              },
              value: todo._id.toString(),
              action_id: "delete_todo",
              style: "danger"
            }
          });
        });
      }
    }

    // ホームタブを更新
    await client.views.publish({
      user_id: event.user,
      view: {
        type: "home",
        blocks
      }
    });
  } catch (error) {
    console.error("ホームタブの更新中にエラーが発生しました:", error);
  }
});

// タスク追加モーダル
app.action('add_todo', async ({ body, ack, client }) => {
  await ack();
  
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "add_todo_modal",
        title: {
          type: "plain_text",
          text: "タスクを追加",
          emoji: true
        },
        submit: {
          type: "plain_text",
          text: "追加",
          emoji: true
        },
        close: {
          type: "plain_text",
          text: "キャンセル",
          emoji: true
        },
        blocks: [
          {
            type: "input",
            block_id: "task_block",
            element: {
              type: "plain_text_input",
              action_id: "task_input",
              placeholder: {
                type: "plain_text",
                text: "タスク内容を入力"
              }
            },
            label: {
              type: "plain_text",
              text: "タスク",
              emoji: true
            }
          },
          {
            type: "input",
            block_id: "channel_block",
            element: {
              type: "conversations_select",
              action_id: "channel_select",
              placeholder: {
                type: "plain_text",
                text: "チャンネルを選択"
              },
              filter: {
                include: ["public", "private"]
              }
            },
            label: {
              type: "plain_text",
              text: "共有するチャンネル",
              emoji: true
            }
          }
        ]
      }
    });
  } catch (error) {
    console.error("モーダルの表示中にエラーが発生しました:", error);
  }
});

// タスク追加モーダルの送信処理
app.view('add_todo_modal', async ({ ack, body, view, client }) => {
  await ack();
  
  const taskText = view.state.values.task_block.task_input.value;
  const channelId = view.state.values.channel_block.channel_select.selected_conversation;
  const userId = body.user.id;
  const userName = body.user.name;
  
  try {
    // タスクをデータベースに追加
    const newTodo = new Todo({
      text: taskText,
      userId,
      userName,
      channelId
    });
    
    await newTodo.save();
    
    // チャンネルにメッセージを送信
    await client.chat.postMessage({
      channel: channelId,
      text: `<@${userId}> が新しいタスクを追加しました: ${taskText}`
    });
    
    // ホームタブの更新
    app.client.views.publish({
      user_id: userId,
      view: await generateHomeTab(userId)
    });
  } catch (error) {
    console.error("タスク追加中にエラーが発生しました:", error);
  }
});

// タスク完了処理
app.action('complete_todo', async ({ ack, body, client }) => {
  await ack();
  
  const todoId = body.actions[0].value;
  const userId = body.user.id;
  
  try {
    // タスクの状態を更新
    const todo = await Todo.findById(todoId);
    todo.completed = true;
    await todo.save();
    
    // ホームタブの更新
    app.client.views.publish({
      user_id: userId,
      view: await generateHomeTab(userId)
    });
  } catch (error) {
    console.error("タスク完了処理中にエラーが発生しました:", error);
  }
});

// タスク削除処理
app.action('delete_todo', async ({ ack, body, client }) => {
  await ack();
  
  const todoId = body.actions[0].value;
  const userId = body.user.id;
  
  try {
    // タスクを削除
    await Todo.findByIdAndDelete(todoId);
    
    // ホームタブの更新
    app.client.views.publish({
      user_id: userId,
      view: await generateHomeTab(userId)
    });
  } catch (error) {
    console.error("タスク削除中にエラーが発生しました:", error);
  }
});

// 完了タスクをクリア
app.action('clear_completed', async ({ ack, body, client }) => {
  await ack();
  
  const userId = body.user.id;
  
  try {
    // 完了したタスクを削除
    await Todo.deleteMany({ userId, completed: true });
    
    // ホームタブの更新
    app.client.views.publish({
      user_id: userId,
      view: await generateHomeTab(userId)
    });
  } catch (error) {
    console.error("完了タスククリア中にエラーが発生しました:", error);
  }
});

// ホームタブのUIを生成する関数
async function generateHomeTab(userId) {
  const userTodos = await Todo.find({ userId }).sort('createdAt');
  
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "あなたの ToDoリスト",
        emoji: true
      }
    },
    {
      type: "divider"
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "タスクの追加、管理、完了をここで行えます。"
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "新しいタスクを追加",
            emoji: true
          },
          action_id: "add_todo"
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "完了したタスクをクリア",
            emoji: true
          },
          action_id: "clear_completed"
        }
      ]
    },
    {
      type: "divider"
    }
  ];

  if (userTodos.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "タスクはありません。新しいタスクを追加しましょう！"
      }
    });
  } else {
    // アクティブなタスク
    const activeTodos = userTodos.filter(todo => !todo.completed);
    if (activeTodos.length > 0) {
      blocks.push({
        type: "header",
        text: {
          type: "plain_text",
          text: "未完了のタスク",
          emoji: true
        }
      });

      activeTodos.forEach(todo => {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `• ${todo.text}`
          },
          accessory: {
            type: "button",
            text: {
              type: "plain_text",
              text: "完了",
              emoji: true
            },
            value: todo._id.toString(),
            action_id: "complete_todo"
          }
        });
      });
    }

    // 完了したタスク
    const completedTodos = userTodos.filter(todo => todo.completed);
    if (completedTodos.length > 0) {
      blocks.push({
        type: "header",
        text: {
          type: "plain_text",
          text: "完了したタスク",
          emoji: true
        }
      });

      completedTodos.forEach(todo => {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `~${todo.text}~`
          },
          accessory: {
            type: "button",
            text: {
              type: "plain_text",
              text: "削除",
              emoji: true
            },
            value: todo._id.toString(),
            action_id: "delete_todo",
            style: "danger"
          }
        });
      });
    }
  }
  
  return {
    type: "home",
    blocks
  };
}

// MongoDB Atlas用の設定
const client = new MongoClient(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 30000,
  // Atlas用の追加設定
  ssl: true,
  sslValidate: true,
  authSource: 'admin'
});

// Express アプリの設定
const expressApp = express();
const PORT = process.env.PORT || 10000;

// MongoDB接続状態のチェック
async function checkMongoHealth() {
  try {
    const database = await connectDB();
    await database.admin().ping();
    console.log('MongoDB health check: OK');
    return true;
  } catch (error) {
    console.error('MongoDB health check failed:', error);
    return false;
  }
}

// 定期的なヘルスチェック
setInterval(async () => {
  const isHealthy = await checkMongoHealth();
  if (!isHealthy) {
    console.warn('MongoDB connection issues detected');
    // 必要に応じて再接続処理
  }
}, 60000); // 1分ごと


// 詳細なログを追加
async function insertTodo(todoData) {
  console.log('Attempting to insert todo:', todoData);
  
  try {
    const startTime = Date.now();
    const database = await connectDB();
    console.log(`DB connection time: ${Date.now() - startTime}ms`);
    
    const collection = database.collection('todos');
    const insertStartTime = Date.now();
    
    const result = await collection.insertOne(todoData);
    console.log(`Insert operation time: ${Date.now() - insertStartTime}ms`);
    console.log('Insert successful:', result.insertedId);
    
    return result;
  } catch (error) {
    console.error('Insert failed with error:', error);
    throw error;
  }
}

// Express サーバーを起動
expressApp.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡️ Express server running on port ${PORT}`);
});

// Slack アプリを起動
(async () => {
  try {
    await app.start();
    console.log('⚡️ Slack ToDoリストアプリが起動しました');
  } catch (error) {
    console.error('アプリの起動に失敗しました:', error);
  }
})();

// アプリの起動
// (async () => {
//   await app.start(process.env.PORT || 3000);
//   console.log('⚡️ Slack ToDoリストアプリが起動しました');
// })();
