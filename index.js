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
      const { date, ...rest } = req.body;
      const newTransaction = {
        ...rest,
        date: new Date(date),
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

    app.get("/reports-summary", async (req, res) => {
      const email = req.query.email;
      // console.log("email", email);
      const category = await transactionsCollection
        .aggregate([
          { $match: { email } },
          { $group: { _id: "$category", total: { $sum: "$amount" } } },
        ])
        .toArray();
      const monthly = await transactionsCollection
        .aggregate([
          { $match: { email } },
          {
            $group: {
              _id: {
                month: { $dateToString: { format: "%Y-%m", date: "$date" } },
                type: "$type",
              },
              total: { $sum: "$amount" },
            },
          },
          {
            $group: {
              _id: "$_id.month",
              income: {
                $sum: {
                  $cond: [{ $eq: ["$_id.type", "Income"] }, "$total", 0],
                },
              },
              expense: {
                $sum: {
                  $cond: [{ $eq: ["$_id.type", "Expense"] }, "$total", 0],
                },
              },
            },
          },
          { $project: { month: "$_id", income: 1, expense: 1, _id: 0 } },
          { $sort: { month: 1 } },
        ])
        .toArray();
      res.status(200).json({ category, monthly });
    });

    app.get("/overviews", async (req, res) => {
      const email = req.query.email;

      const income = await transactionsCollection
        .aggregate([
          { $match: { email: email, type: "Income" } },
          { $group: { _id: null, totalIncome: { $sum: "$amount" } } },
        ])
        .toArray();
      const expense = await transactionsCollection
        .aggregate([
          { $match: { email: email, type: "Expense" } },
          { $group: { _id: null, totalExpense: { $sum: "$amount" } } },
        ])
        .toArray();

      const totalIncome = income[0]?.totalIncome || 0;
      const totalExpense = expense[0]?.totalExpense || 0;
      const balance = totalIncome - totalExpense;
      console.log(totalExpense, totalIncome, balance);
      res.status(200).json({ totalIncome, totalExpense, balance });
    });

    app.patch(
      "/transaction/update/:id",
      verifyFireBaseToken,
      async (req, res) => {
        const id = req.params.id;
        const email = req.query.email;

        const { date, ...rest } = req.body;

        const updateData = {
          ...rest,
          date: new Date(date),
          updatedAt: new Date(),
        };

        delete updateData.email;
        delete updateData.name;
        delete updateData.createdAt;

        const query = {};
        if (email) {
          query.email = email;
          if (email !== req.token_email) {
            return res.status(403).send({ message: "forbidden access" });
          }
        }

        console.log(email, id, "from patch");

        try {
          const result = await transactionsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
          );

          if (result.matchedCount === 0) {
            return res.status(404).send({ message: "Wrong Transaction Id" });
          }
          res.send(result);
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Failed to update" });
        }
      }
    );
  } finally {
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Smart server is running on port: ${port}`);
});
