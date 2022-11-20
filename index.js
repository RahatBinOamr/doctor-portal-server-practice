const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
// console.log(stripe);
const port = process.env.PORT || 5000;

/* middle ware  */
app.use(cors());
app.use(express.json());

const uri = process.env.USER_URL;
// console.log(uri)
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

/* verify jwt function */
function verifyJWT(req, res, next) {
  console.log("token in side", req.headers.authorization);
  const authHeaders = req.headers.authorization;
  if (!authHeaders) {
    return res.status(401).send("unAuthorized access ");
  }
  const token = authHeaders.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      res.status(403).send({ message: "forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    const appointmentOptionCollection = client
      .db("doctorPortal")
      .collection("apppointmentOptons");
    const bookingCollection = client.db("doctorPortal").collection("bookings");
    const usersCollection = client.db("doctorPortal").collection("users");
    const doctorsCollection = client.db("doctorPortal").collection("doctors");
    const paymentsCollection = client.db("doctorPortal").collection("payments");

    /* Verify admin  */
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      // console.log(date);
      const query = {};
      const options = await appointmentOptionCollection.find(query).toArray();
      // console.log(options);

      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingCollection
        .find(bookingQuery)
        .toArray();
      options.forEach((option) => {
        const optionBooked = alreadyBooked.filter(
          (book) => book.treatment === option.name
        );
        // console.log(optionBooked)
        const bookSlots = optionBooked.map((book) => book.slot);
        const remainingSlots = option.slots.filter(
          (slot) => !bookSlots.includes(slot)
        );
        option.slots = remainingSlots;
        console.log(bookSlots, option.name, remainingSlots);
      });

      res.send(options);
    });
    /* payment booking  */
    app.get("/booking/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const booking = await bookingCollection.findOne(query);
      console.log(booking);
      res.send(booking);
    });
    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }
      // console.log('token',req.headers.authorization);
      const query = { email: email };
      const bookings = await bookingCollection.find(query).toArray();
      res.send(bookings);
    });

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      console.log(booking);
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment,
      };

      const alreadyBooked = await bookingCollection.find(query).toArray();

      if (alreadyBooked.length) {
        const message = `You already have a booking on ${booking.appointmentDate}`;
        return res.send({ acknowledged: false, message });
      }

      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });
    /* create payment intention method using stripe method*/
    app.post('/create-payment-intent', async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;

      const paymentIntent = await stripe.paymentIntents.create({
          currency: 'usd',
          amount: amount,
          "payment_method_types": [
              "card"
          ]
      });
      res.send({
          clientSecret: paymentIntent.client_secret,
      });
  });
/* payment information collection using paymentsCollection */
app.post('/payments',async(req,res)=>{
  const payment = req.body;
  const result = await paymentsCollection.insertOne(payment);
  const id = payment.bookingId;
  const filter = {_id:ObjectId(id)};
  const updateDoc={
    $set:{
      paid:true,
      transactionId:payment.transactionId
    }
  }
  const updateResult = await bookingCollection.updateOne(filter,updateDoc)
  res.send(result)
})
    /* User information with jwt=jason web token */
    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      console.log(user);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN);
        return res.send({ accessToken: token });
      }
      res.status(403).send({ excessToken: "" });
    });
    /* All Users information */
    app.get("/users", async (req, res) => {
      const query = {};
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });
    /* get user information */
    app.post("/users", async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });
    /* update users admin information */
    app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });
    /* add or update price field on price on appointment options temporary using appointmentOptionsCollection */

    /*  app.get('/addPrices',async(req,res)=>{
      const filter = {};
      const options = {upsert:true};
      const updateDoc = {
        $set:{
          price:100
        }
      }
      const result = await appointmentOptionCollection.updateMany(filter,updateDoc,options)
      console.log(result)
      res.send(result)

    }) */

    /* check admin user information */
    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      console.log(email);
      const query = { email };
      const user = await usersCollection.findOne(query);
      // console.log({isAdmin:user?.role==='admin'})
      res.send({ isAdmin: user?.role === "admin" });
    });
    /* Add doctor information using appointmentOption collection */
    app.get("/appointmentSpecialty", async (req, res) => {
      const query = {};
      const result = await appointmentOptionCollection
        .find(query)
        .project({ name: 1 })
        .toArray();
      console.log(result);
      res.send(result);
    });
    /*create doctor collection using doctorsCollection */
    app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorsCollection.insertOne(doctor);
      console.log(result);
      res.send(result);
    });
    /*get doctors details using doctorsCollection */

    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const doctor = await doctorsCollection.find(query).toArray();
      console.log(doctor);
      res.send(doctor);
    });
    /* delete doctor using doctorCollection */
    app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const result = await doctorsCollection.deleteOne(filter);
      console.log(result);
      res.send(result);
    });
  } finally {
  }
}
run().catch((err) => console.error(err));

app.get("/", (req, res) => {
  res.send(`server is running on doctor portal ${port}`);
});
app.listen(port, console.log("server is running", port));

/* Support Email:
1. tarique@programming-hero.com
2. ishtiaque@programming-hero.com

https://docs.google.com/presentation/d/1XE4YPuC0ctuEevurSZkFuvy6Mu7ZeTjI-dJ5Llb3zFo/edit?usp=sharing

https://docs.google.com/presentation/d/1XE4YPuC0ctuEevurSZkFuvy6Mu7ZeTjI-dJ5Llb3zFo/edit?usp=sharing

https://docs.google.com/forms/d/e/1FAIpQLSfyylJtEL1LqgwXvM5NEsw_ba1ru6Tcj7fwMb3-kyd1BZRXQw/viewform

 */

/* 
https://docs.google.com/presentation/d/1ktzBWihXp5_yeEbW7Jx4OPxYbs1nlMLc/edit?usp=sharing&ouid=109222772944944360426&rtpof=true&sd=true
https://docs.google.com/presentation/d/1hy1wqwHBnmQZBsdgltIeV6fu5-Pb5X7q/edit?usp=sharing&ouid=109222772944944360426&rtpof=true&sd=true
https://forms.gle/XGbqTRLgXEKW7yNi9
Support Email: 1. tarique@programming-hero.com 2. ishtiaque@programming-hero.com
https://forms.gle/XGbqTRLgXEKW7yNi9

*/
/* 
Attendance form link: https://forms.gle/aBkaQDCGmLFscsfH9
 */
/* 
https://docs.google.com/presentation/d/1PkwholH6j2QmB0Hjd65DI9xncjbeJUD-BsSAuI0tl1Q/preview?pru=AAABhLTFO3g*s0N4fmnVBv_i9udoh3OZIg&slide=id.g1983e0e08dd_0_370
*/
/* 
attendance from link:https://docs.google.com/forms/d/e/1FAIpQLScwgCxgbgcikNtbk442HTBU1I9CwhiidBJWd2cpu19EbnLVww/viewform
*/
