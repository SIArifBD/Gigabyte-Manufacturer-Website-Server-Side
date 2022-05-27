const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express();
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());

//mongoDB
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.idqrg.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

//JSON Web Token
function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.send(401).send({ message: 'UnAuthorized Access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' })
        }
        req.decoded = decoded;
        next();
    })
};

async function run() {
    try {
        await client.connect();
        const productCollection = client.db('gigabyte-manufacturer').collection('products');
        const orderCollection = client.db('gigabyte-manufacturer').collection('orders');
        const userCollection = client.db('gigabyte-manufacturer').collection('users');
        const reviewCollection = client.db('gigabyte-manufacturer').collection('reviews');
        const paymentCollection = client.db('gigabyte-manufacturer').collection('payments');


        //admin verify
        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'Forbidden Access' });
            }
        };
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret })
        });

        //get all user
        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        });

        //get admin
        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });
        });

        //get admin
        // app.get('/notAdmin/:email', verifyNotAdmin, async (req, res) => {
        //     const email = req.params.email;
        //     const user = await userCollection.findOne({ email: email });
        //     const isNotAdmin = user.role !== 'admin';
        //     res.send({ notAdmin: isNotAdmin });
        // });

        //make admin
        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        //user email send with jwt token
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1d' })
            res.send({ result, token });
        });

        //get all computer parts
        app.get('/product', async (req, res) => {
            const query = {};
            const cursor = productCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        });
        //get one parts 
        app.get('/product/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await productCollection.findOne(query);
            res.send(result);
        });
        //add products
        app.post('/product', verifyJWT, verifyAdmin, async (req, res) => {
            const product = req.body;
            const result = await productCollection.insertOne(product);
            res.send(result);
        });
        //delete product
        app.delete('/product/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await productCollection.deleteOne(filter);
            res.send(result);
        });
        //order post api
        app.post('/order', verifyJWT, async (req, res) => {
            const order = req.body;
            const query = { product: order.product, name: order.name };
            const exists = await orderCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, order: exists });
            }
            const result = await orderCollection.insertOne(order);
            res.send({ success: true, result });
        });
        //get order api
        app.get('/order', verifyJWT, async (req, res) => {
            const user = req.query.user;
            const decodedEmail = req.decoded.email;
            if (user === decodedEmail) {
                const query = { user: user };
                const result = await orderCollection.find(query).toArray();
                res.send(result);
            }
            else {
                return res.send(403).send({ message: 'Forbidden Access' });
            }
        });
        app.get('/order/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await orderCollection.findOne(query);
            res.send(result);
        });
        app.patch('/order/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updateDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const result = await paymentCollection.insertOne(payment);
            const updatedOrder = await orderCollection.updateOne(filter, updateDoc);
            res.send(updatedOrder);
        })
        //delete order
        app.delete('/order/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await orderCollection.deleteOne(filter);
            res.send(result);
        });
        //post review
        app.post('/review', verifyJWT, async (req, res) => {
            const review = req.body;
            const result = await reviewCollection.insertOne(review);
            res.send(result);
        });
        //get all review
        app.get('/review', async (req, res) => {
            const query = {};
            const cursor = reviewCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        });
    }
    finally {

    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello from manufacturer website');
});

app.listen(port, () => {
    console.log(`Manufacturer Website Listening on Port ${port}`);
});