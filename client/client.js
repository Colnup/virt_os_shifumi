const WebSocket = require("ws")
const readline = require("readline")

const SERVER_URL = process.env.SERVER_URL || "ws://localhost:8080"
const INTERACTIVE = process.env.INTERACTIVE !== "false"

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
let ws
let inMatch = false
let currentOpponent = null
let prompting = false

function connect() {
  ws = new WebSocket(SERVER_URL)

  ws.on("open", () => {
    console.log("Connected to server at", SERVER_URL)
    ws.send(JSON.stringify({ type: "join" }))
  })

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString())
      handleMessage(msg)
    } catch (err) {
      console.error("Invalid message from server:", data.toString())
    }
  })

  ws.on("close", () => {
    console.log("Disconnected from server")
    process.exit(0)
  })

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message)
  })
}

function handleMessage(msg) {
  switch (msg.type) {
    case "playerCount":
      console.log(`Players connected: ${msg.count}`)
      break
    case "tournamentStart":
      console.log("Tournament starting with players:", msg.players)
      break
    case "matchStart":
      inMatch = true
      currentOpponent = msg.opponentId
      console.log(`Match started against player ${currentOpponent}`)
      promptChoice()
      break
    case "matchBye":
      console.log("You received a bye and advance to next round.")
      break
    case "tieBreak":
      console.log(`Tie! Opponent chose ${msg.opponentChoice}. Choose again.`)
      promptChoice()
      break
    case "matchResult":
      console.log(`Match result: ${msg.result.toUpperCase()}`)
      console.log(`Your choice: ${msg.yourChoice} | Opponent: ${msg.opponentChoice}`)
      inMatch = false
      currentOpponent = null
      break
    case "gameResult":
      // used when opponent disconnects
      console.log(`Game result: ${msg.result.toUpperCase()}`)
      console.log(`Your choice: ${msg.yourChoice} | Opponent: ${msg.opponentChoice}`)
      if (msg.note) console.log("Note:", msg.note)
      inMatch = false
      currentOpponent = null
      break
    case "tournamentEnd":
      if (msg.message) console.log(msg.message)
      if (msg.championId != null) console.log(`Tournament champion: ${msg.championId}`)
      break
    case "error":
      console.error("Server error:", msg.message)
      break
    default:
      console.log("Unknown message type:", msg)
  }
}

function promptChoice() {
  if (!inMatch || prompting) return

  if (!INTERACTIVE) {
    // Auto-play random choice
    const choices = ["rock", "paper", "scissors"]
    const choice = choices[Math.floor(Math.random() * choices.length)]
    ws.send(JSON.stringify({ type: "choice", choice }))
    console.log("Auto-choice sent:", choice)
    return
  }

  prompting = true

  rl.question("Choose (rock/paper/scissors): ", (answer) => {
    prompting = false
    const choice = answer.trim().toLowerCase()
    if (!["rock", "paper", "scissors"].includes(choice)) {
      console.log("Invalid choice. Please type rock, paper, or scissors.")
      // reprompt
      promptChoice()
      return
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "choice", choice }))
      console.log("Choice sent:", choice)
    } else {
      console.error("Not connected to server.")
    }
  })
}

// Gracefully handle Ctrl+C
process.on("SIGINT", () => {
  console.log("\nExiting...")
  rl.close()
  if (ws) ws.close()
  process.exit(0)
})

connect()
