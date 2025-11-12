const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const serviceAccount = require("./finease-admin-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
app.use(cors());
app.use(express.json());

const verifyFireBaseToken = async (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = authorization.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    console.log("inside token", decoded);
    req.token_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.sdvseqc.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get("/", (req, res) => {
  res.send("Server is running");
});

async function run() {
  try {
    await client.connect();
    const db = client.db("fin_db");
    const transactionsCollection = db.collection("transactions");

    app.post("/add-transaction", async (req, res) => {
      const newTransaction = {
        ...req.body,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      console.log(newTransaction);
      const result = await transactionsCollection.insertOne(newTransaction);
      res.send(result);
    });
    app.get("/my-transactions", verifyFireBaseToken, async (req, res) => {
      // console.log(req.query);
      const { sort = "createdAt", order = -1, email } = req.query;
      // const email = req.query.email;
      console.log(email, req.token_email);
      const query = {};
      if (email) {
        query.email = email;
        if (email !== req.token_email) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }
      const sortField =
        sort === "date" ? "date" : sort === "amount" ? "amount" : "createdAt";
      const sortOrder = order === "1" ? 1 : -1;

      const cursor = transactionsCollection
        .find(query)
        .sort({ [sortField]: sortOrder });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.delete("/transaction/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await transactionsCollection.deleteOne(query);
      res.send(result);
    });
    app.get("/transaction/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await transactionsCollection.findOne(query);
      res.send(result);
    });

    app.get("/total-transactions", verifyFireBaseToken, async (req, res) => {
      const category = req.query.category;
      const email = req.query.email;
      const query = {};
      if (email) {
        query.email = email;
        if (email !== req.token_email) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }
      console.log(email, category, "from total");

      const result = await transactionsCollection
        .aggregate([
          {
            $match: {
              email,
              category,
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: "$amount" },
            },
          },
        ])
        .toArray();

      const total = result.length > 0 ? result[0].total : 0;
      return res.json({ total });
    });
  } finally {
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Smart server is running on port: ${port}`);
});
