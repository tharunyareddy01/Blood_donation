
const express = require("express");
const mysql = require("mysql8");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: "blood_donation"
});

db.connect((err) => {
    if (err) {
        console.error("MySQL connection error:", err.message);
        return;
    }

    console.log("Connected to blood_donation database");
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Check database connection
function checkDatabase(req, res, next) {
    if (!db.threadId) {
        return res.status(503).json({
            error: "Database is not connected. Check MySQL settings."
        });
    }

    next();
}

// Validate donor fields
function validateDonor(body) {
    const donor_name = String(body.donor_name || "").trim();
    const phone_number = String(body.phone_number || "").trim();
    const ageValue = body.age;
    const blood_group = String(body.blood_group || "").trim();
    const gender = String(body.gender || "").trim();

    const digits = phone_number.replace(/\D/g, "");
    const age = Number(ageValue);

    const validBloodGroups = [
        "A+", "A-", "B+", "B-",
        "O+", "O-", "AB+", "AB-"
    ];

    const validGenders = [
        "Male",
        "Female",
        "Other",
        "Prefer not to say"
    ];

    if (!donor_name || donor_name.length > 100) {
        return {
            error: "Enter a donor name (maximum 100 characters)."
        };
    }

    if (
        !/^[0-9+() -]+$/.test(phone_number) ||
        digits.length < 7 ||
        digits.length > 15
    ) {
        return {
            error: "Enter a valid phone number containing 7–15 digits."
        };
    }

    if (
        ageValue === undefined ||
        ageValue === null ||
        String(ageValue).trim() === "" ||
        !Number.isInteger(age) ||
        age < 18 ||
        age > 100
    ) {
        return {
            error: "Age must be a whole number between 18 and 100."
        };
    }

    if (!validBloodGroups.includes(blood_group)) {
        return {
            error: "Please select a valid blood group."
        };
    }

    if (!validGenders.includes(gender)) {
        return {
            error: "Please select a valid gender."
        };
    }

    return {
        donor_name,
        phone_number,
        age,
        blood_group,
        gender
    };
}

// Get all donors and search by ID or name
app.get("/api/donors", checkDatabase, (req, res) => {
    const search = String(req.query.search || "").trim();
    const term = `%${search}%`;

    const sql = `
        SELECT
            donor_id,
            donor_name,
            phone_number,
            age,
            blood_group,
            gender
        FROM donors
        WHERE CAST(donor_id AS CHAR) LIKE ?
           OR donor_name LIKE ?
        ORDER BY donor_id DESC
    `;

    db.query(sql, [term, term], (err, rows) => {
        if (err) {
            console.error("Load donors error:", err.message);

            return res.status(500).json({
                error: "Unable to load donors."
            });
        }

        res.json(rows);
    });
});

// Get total donor count
app.get("/api/donors/count", checkDatabase, (req, res) => {
    db.query(
        "SELECT COUNT(*) AS total FROM donors",
        (err, rows) => {
            if (err) {
                console.error("Count donors error:", err.message);

                return res.status(500).json({
                    error: "Unable to count donors."
                });
            }

            res.json({
                total: rows[0].total
            });
        }
    );
});

// Find one donor by ID
app.get("/api/donors/:id", checkDatabase, (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({
            error: "Enter a valid Donor ID."
        });
    }

    const sql = `
        SELECT
            donor_id,
            donor_name,
            phone_number,
            age,
            blood_group,
            gender
        FROM donors
        WHERE donor_id = ?
    `;

    db.query(sql, [id], (err, rows) => {
        if (err) {
            console.error("Find donor error:", err.message);

            return res.status(500).json({
                error: "Search failed."
            });
        }

        if (rows.length === 0) {
            return res.status(404).json({
                error: "Donor not found."
            });
        }

        res.json(rows[0]);
    });
});

// Register donor using a MANUALLY ENTERED Donor ID
app.post("/api/donors", checkDatabase, (req, res) => {
    const donorIdValue = req.body.donor_id;

    // Validate the manually entered ID
    if (
        donorIdValue === undefined ||
        donorIdValue === null ||
        String(donorIdValue).trim() === "" ||
        !/^[1-9]\d*$/.test(String(donorIdValue).trim()) ||
        !Number.isSafeInteger(Number(donorIdValue))
    ) {
        return res.status(400).json({
            error: "Enter a valid positive whole-number Donor ID."
        });
    }

    const donor_id = Number(donorIdValue);
    const donor = validateDonor(req.body);

    if (donor.error) {
        return res.status(400).json({
            error: donor.error
        });
    }

    const sql = `
        INSERT INTO donors
            (
                donor_id,
                donor_name,
                phone_number,
                age,
                blood_group,
                gender
            )
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    const values = [
        donor_id,
        donor.donor_name,
        donor.phone_number,
        donor.age,
        donor.blood_group,
        donor.gender
    ];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("Registration error:", err.message);

            // Handle duplicate Donor ID
            if (err.code === "ER_DUP_ENTRY") {
                return res.status(409).json({
                    error: `Donor ID ${donor_id} already exists. Please enter a different ID.`
                });
            }

            return res.status(500).json({
                error: "Registration failed. Please check the database table and fields."
            });
        }

        res.status(201).json({
            message: "Donor registered successfully!",
            donor: {
                donor_id,
                ...donor
            }
        });
    });
});

// Update donor details
app.put("/api/donors/:id", checkDatabase, (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({
            error: "Enter a valid Donor ID."
        });
    }

    const donor = validateDonor(req.body);

    if (donor.error) {
        return res.status(400).json({
            error: donor.error
        });
    }

    const sql = `
        UPDATE donors
        SET
            donor_name = ?,
            phone_number = ?,
            age = ?,
            blood_group = ?,
            gender = ?
        WHERE donor_id = ?
    `;

    const values = [
        donor.donor_name,
        donor.phone_number,
        donor.age,
        donor.blood_group,
        donor.gender,
        id
    ];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("Update donor error:", err.message);

            return res.status(500).json({
                error: "Update failed."
            });
        }

        if (result.affectedRows === 0) {
            return db.query(
                "SELECT donor_id FROM donors WHERE donor_id = ?",
                [id],
                (checkErr, rows) => {
                    if (checkErr) {
                        return res.status(500).json({
                            error: "Database error."
                        });
                    }

                    if (rows.length === 0) {
                        return res.status(404).json({
                            error: "Donor not found."
                        });
                    }

                    res.json({
                        message: "No changes were needed."
                    });
                }
            );
        }

        res.json({
            message: "Donor updated successfully!"
        });
    });
});

// Delete donor
app.delete("/api/donors/:id", checkDatabase, (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({
            error: "Enter a valid Donor ID."
        });
    }

    db.query(
        "DELETE FROM donors WHERE donor_id = ?",
        [id],
        (err, result) => {
            if (err) {
                console.error("Delete donor error:", err.message);

                return res.status(500).json({
                    error: "Deletion failed."
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    error: "Donor not found."
                });
            }

            res.json({
                message: "Donor deleted successfully!"
            });
        }
    );
});

// Home page
app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
