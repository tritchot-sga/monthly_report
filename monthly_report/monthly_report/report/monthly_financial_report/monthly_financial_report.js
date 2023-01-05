// ============================================================================================================================================
// GLOBAL FLAGS
// ============================================================================================================================================

var minus_to_brackets = 0; // determines if negative numbers are to be represented with brackets instead: i.e., -1 to (1)
var download_excel    = 1; // determines if the excel spreadsheet is to be downloaded at the end of processing
var debug_output      = 0; // determines if console logs should be printed
var skinny_bs_v1      = 0; // swtiches between the two version of balance sheets
var include_timestamp = 0;

// ============================================================================================================================================
// GLOBAL VARIABLES
// ============================================================================================================================================

var indent              = "&nbsp;&nbsp;&nbsp;&nbsp;"; // prints an indent of 4 spaces
var start_time;
var filters
var _dataset            = [];
var month_name          = "";
var curr_month_year     = "";
var prev_month_year     = "";
var global_total_income = []; // holds total values for a category in global scope 
var global_income_taxes = [];
var global_gross_profit = [];
var ttm_period          = [];
var tables_array        = []; // give each table an ID to later identify them in the export function
var current_table_id    = 0;
var number_format       = new Intl.NumberFormat('en-US'); // number format definition
var download_success    = false;

// years to go in the filter
const filter_years = () => {
    let years_in_filter = [];
    let curr_year = (new Date().getFullYear());

    while (curr_year != "2015")
        years_in_filter.push(curr_year--).toString();
    
    return years_in_filter;
}

// months to go in the filter
const filter_months = () => {
    return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
}

// categories in the income statements
const income_statement_categories = [
    "Product Sales", "Other Income", // income
    "Operating Expenses", "Other Expenses", // expenses
];

// categories in the balance sheets
const balance_sheet_categories = [
    "Current Assets", "Fixed Assets", // assets
    "Accounts Payable", "Current Liabilities", "Duties and Taxes", "Long-Term Liabilities" // liabilities
];

// ============================================================================================================================================
// MAIN
// ============================================================================================================================================


frappe.query_reports["Monthly Financial Report"] = {
    "filters": [
        // visible filters
        {
            "fieldname": "to_fiscal_year",   
            "label"    : "End Year",
            "fieldtype": "Select", 
            "reqd"     : true,
            "hidden"   : false,
            "default"  : filter_years()[0],
            "options"  : filter_years()
        },
        {
            "fieldname": "period_end_month", 
            "label"    : "Month",            
            "fieldtype": "Select", 
            "reqd"     : true,
            "hidden"   : false,
            "default"  : filter_months()[new Date().getMonth()],
            "options"  : filter_months()
        },
        {
            "fieldname": "report_type",      
            "label"    : "Report Type",      
            "fieldtype": "Select", 
            "reqd"     : true,
            "hidden"   : false,
            "default"  : "Regular",
            "options"  : ["Detailed", "Regular", "Skinny"]
        },
        {
            "fieldname": "cost_center",      
            "label"    : "Cost Center",      
            "fieldtype": "MultiSelectList", 
            "get_data" : function(txt) {
                return frappe.db.get_link_options(
                    'Cost Center', txt, {company: frappe.query_report.get_filter_value("company")}
                );
            }
        },

        // hidden filters
        {
            "fieldname": 'company',
            "label"    : "Company",
            "fieldtype": 'Link',
            "reqd"     : false,
            "hidden"   : true,
            "default"  : frappe.defaults.get_user_default('company'),
            "options"  : 'Company'
        },
        {
            "fieldname": "finance_book",     
            "label"    : "Finance Book",     
            "fieldtype": "Link",   
            "reqd"     : false,
            "hidden"   : true,
            "options"  : "Finance Book"
        },
        {
            "fieldname": "periodicity",      
            "label"    : "Periodicity",      
            "fieldtype": "Select", 
            "reqd"     : true,
            "hidden"   : true,
            "default"  :"Monthly",
            "options"  : [{ "value": "Monthly", "label": __("Monthly") }]
        },
        {
            "fieldname": "filter_based_on",  
            "label"    : "Filter Based On",  
            "fieldtype": "Select", 
            "reqd"     : true,
            "hidden"   : true,
            "default"  : "Fiscal Year",
            "options"  : ["Fiscal Year", "Date Range"]
        },
    ],

    onload: function(report) {
        report.page.add_inner_button(__("Export Report"), function () {
            filters = report.get_values();
            console.log(filters);

            if (test_dataset[0].length > 1) {
                test_run();
            } else {
                start_time = new Date();

                if (download_success)            frappe.throw('Please refresh the page before generating a new report');
                if (!filters.period_end_month)   frappe.throw('Please select an ending month');
                if (!filters.to_fiscal_year)     frappe.throw('Please select an ending year');
                if (!filters.cost_center.length) frappe.throw('Please select at least one cost center');
    
                gather_data();
            }
        });
    }
}

//
function gather_data(curr_thing_to_query = 0) {
    let things_to_query = ['Consolidated', 'Balance Sheet'];
    for (let i = 0; i < filters.cost_center.length; i++) 
        things_to_query.push(filters.cost_center[i]);

    if (curr_thing_to_query < things_to_query.length) {
        frappe.show_progress('Generating Report', curr_thing_to_query, things_to_query.length, `Gathering data: ${things_to_query[curr_thing_to_query]}`);

        frappe.call({
            method: 'monthly_report.monthly_report.report.monthly_financial_report.custom_monthly_financial_report.run_queries',
            args: {filters: filters, cost_center_name: things_to_query[curr_thing_to_query]},

            callback: function (r) {
                _dataset.push(r.message[0]);
                _dataset.push(remove_blank_entries(r.message[1]));
                gather_data(++curr_thing_to_query);
            }
        })
    } else {
        generate_report([_dataset]);

        // Total execution time for display
        var total_time = ((new Date()).getTime() - start_time.getTime()) / 1000;
        var minutes = Math.floor(total_time / 60);
        var seconds = Math.round(total_time - (minutes * 60));
        var display_time = (minutes > 0 ? `${minutes} minute${minutes > 1 ? 's' : ''} and ` : '') + `${seconds} second${seconds != 1 ? 's' : ''}`;

        frappe.show_progress('Generating Report', 1, 1, `Completed in ${display_time}`);
    }
}

//
function remove_blank_entries(dirty_dataset) {
    clean_dataset = [];

    if (dirty_dataset.length <= 1)
        return clean_dataset.push({"no_data" : "true"});

    for (let i = 0; i < dirty_dataset.length; i++) 
        if (dirty_dataset[i]['account'] || dirty_dataset[i]['dataset_for']) 
            clean_dataset.push(dirty_dataset[i]);
    return clean_dataset;
}

// initiates global variables
function init_globals() {
    console.log(filters);
    // date info needed to generate the tables
    month_name = (filters.period_end_month.slice(0, 3)).toLowerCase();
    curr_month_year = month_name + "_" + filters.to_fiscal_year;
    prev_month_year = month_name + "_" + (parseInt(filters.to_fiscal_year) - 1).toString();

    global_total_income = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    global_income_taxes = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    global_gross_profit = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    ttm_period          = get_ttm_period(curr_month_year);
    tables_array        = []; 
    current_table_id    = 0;
    download_success    = false;
}

// (unused???) finds the names of categories
function get_category_names(dataset) {
    for (let i = 0; i < dataset.length; i++)
        if (dataset[i]['indent'] == 1)
            console.log(dataset[i]['account']); 
}


// ============================================================================================================================================
// GENERATOR FUNCTIONS
// ============================================================================================================================================


// generates the entire table by calling functions that generate the css, caption, header, and body
function generate_report(dataset) {
    console.log(dataset);
    init_globals();

    var html = "";
    html += generate_ytd_tables(dataset); // generates year to date sheets 
    html += generate_ttm_tables(dataset); // generates trailing twelve months sheets
    html += generate_bal_tables(dataset); // generates balance sheets

    // append the css & html, then export as xls
    $(".report-wrapper").hide();
    $(".report-wrapper").append(html);

    // flags to control the export and download -- used for testing without filling the downloads folder with junk
    download_excel ? tables_to_excel(tables_array, generate_filename(), generate_tabs(dataset)) : console.log("Download flag is set to false"); ;
}

// generates year to date sheets 
function generate_ytd_tables(dataset) {
    let html = "";
    let consolidated_data = dataset[0][1];
    let mode = "year_to_date";

    // populate it first with consolidated sheet
    let $table_id = "consolidated_ytd";
    tables_array.push("#" + $table_id);
    html += generate_single_table(consolidated_data, $table_id, "Consolidated Income Statement", mode);
    
    if (filters.cost_center.length > 1) {
        // appends individual cost center income statement sheets
        for (let i = 0; i < filters.cost_center.length; i++)
            html += generate_per_cost_center(dataset, filters.cost_center[i], mode);
    }
    return html;
}

// generates trailing twelve months sheets
function generate_ttm_tables(dataset) {
    let html = "";
    let consolidated_data = dataset[0][1];
    let mode = "trailing_12_months";

    if (filters.report_type != "Skinny") {
        // appends the Trailing Twelve Months sheets
        let $table_id = "consolidated_ttm";
        tables_array.push("#" + $table_id);
        html += generate_single_table(consolidated_data, $table_id, "Consolidated Income Statement", mode);

        if (filters.cost_center.length > 1) {
            current_table_id++;
            for (let i = 0; i < filters.cost_center.length; i++)
                html += generate_per_cost_center(dataset, filters.cost_center[i], mode);
        }
    }

    return html;
}

// generates balance sheets
function generate_bal_tables(dataset) {
    let html = "";
    let balance_sheet_data = dataset[0][3];

    // appends the Balance Sheet
    let $table_id = "balance_sheet";
    tables_array.push("#" + $table_id);
    html += generate_single_table(balance_sheet_data, $table_id, "Consolidated Balance Sheet", mode = "balance_sheet");

    return html;
}

// generates the filename for the downloaded excel file
function generate_filename() {
    let formatDate = (date) => {
        var hours = date.getHours();
        var minutes = date.getMinutes();
        var ampm = hours >= 12 ? 'PM' : 'AM';

        hours = hours % 12;
        hours = hours ? hours : 12; // the hour '0' should be '12'
        minutes = minutes < 10 ? '0'+ minutes : minutes;
        var strTime = hours + '꞉' + minutes + ' ' + ampm;
        return "(" + date.getFullYear() + "." + (date.getMonth()+1) + "." + date.getDate() + ", " + strTime + ")";
    }

    let filename_builder = (month_year, type, time = "") => {
        let text = "";
        text += ("Monthly Report, " + type + ", ");
        text += (capitialize_each_word(month_year).replace("_", " "));
        if (time != "") text += (" " + formatDate(time));

        return text + ".xls";
    }
    

    if (include_timestamp)
        return filename_builder(curr_month_year, filters.report_type, start_time);
    return filename_builder(curr_month_year, filters.report_type);
}

// creates tabs based on the cost centers selected in the filters
function generate_tabs(dataset) {
    var center_numbers = [];
    let consolidated_data = dataset[0][1];

    if (consolidated_data.length > 0) {
        // process the cost center numbers to creat the excel sheet names on the tabs
        // append the *Income Statement* numbers to the list of cost centers
        if (filters.cost_center.length > 1) 
            center_numbers.push("0_IS");
    
        for (let i = 0; i < filters.cost_center.length; i++)
            center_numbers.push(filters.cost_center[i].slice(1, 2) + "_IS");
    
        // append the *Trailing 12 Months* numbers to the list of cost centers
        if (filters.report_type != "Skinny") {
            if (filters.cost_center.length > 1) 
                center_numbers.push("0_TTM");
    
            for (let i = 0; i < filters.cost_center.length; i++)
                center_numbers.push(filters.cost_center[i].slice(1, 2) + "_TTM");
        }
    }

    // append the *Balance Sheet* number
    center_numbers.push("0_BS");

    return center_numbers;
}

// generate a table for the cost center passed in arg
function generate_per_cost_center(dataset, cost_center_name, mode) {
    $table_id = "table_" + current_table_id;
    tables_array.push("#" + $table_id);
    current_table_id++;

    return generate_single_table(dataset, $table_id, "Consolidated Income Statement", mode, cost_center_name);
}

// shortcut that generates the consolidated table without extra adjustments 
function generate_single_table(dataset, $table_id, title, mode, cost_center_name = "") {
    let html = ""
    
    if (cost_center_name == "") {
        // css for the table 
        html = generate_table_css();

        // the table containing all the data in html format
        html += '<div id="data">';
        html += '<table style="font-weight: normal; font-family: Calibri; font-size: 10pt" id=' + $table_id + '>';
        html += generate_table_caption(title, mode);
        html += generate_table_head(mode);
        html += generate_table_body(dataset, mode);
        html += '</table>';
        html += '</div>';

    } else {
        html += '<div id="data">';
        html += '<table style="font-weight: normal; font-family: Calibri; font-size: 10pt" id=' + $table_id + '>';
        html += generate_table_caption((cost_center_name.slice(5, -5) + " Income Statement"), mode);
        html += generate_table_head(mode);

        mode == "year_to_date" ? start_index = 0 : start_index = 1;

        for (let j = start_index; j < dataset[0].length; j++) {
            if (dataset[0][j][0]["dataset_for"] === cost_center_name) {
                html += generate_table_body(dataset[0][j+1], mode);
                break;
            }
        }

        html += '</table>';
        html += '</div>';
    }

    return html;
}

// generates the css for the html
function generate_table_css() {
    var table_css = "";

    table_css += '<style>';
    table_css += '.table-data-right { font-family: Calibri; font-weight: normal; text-align: right; }';
    table_css += '</style>';

    return table_css;
}

// generates the table's caption on top
function generate_table_caption(title, mode) {
    var table_caption = "";
    var date = get_last_date(filters.period_end_month, filters.to_fiscal_year);
    var span = (contents = "") => { return '<span style="font-family: Calibri; font-size: 10pt; text-align: left;">' + contents + '</span>'; }

    table_caption += '<caption style="text-align: left;">';
    table_caption += span(filters.company + '</br>');
    table_caption += span(title + '</br>');
    if (!(filters.report_type == "Skinny" && mode == "balance_sheet"))
        table_caption += span(filters.period_end_month + '&nbsp;' + date + '&nbsp;' + filters.to_fiscal_year);
    table_caption += '</caption>';

    return table_caption;
}

// generates the table's column names
function generate_table_head(mode) {
    var html = "";
    var blank_column = indent + indent + indent + indent + indent;
    var date = get_last_date(filters.period_end_month, filters.to_fiscal_year);
    var th = (contents = "") => { return '<th style="text-align: right; font-size: 10pt" colspan=1>' + contents + '</th>'; }

    html += '<thead>';
    html += '<tr style="border-top: 1px solid black; border-bottom: 1px solid black;">';
    if (filters.report_type == "Skinny") {
        if (mode == "year_to_date") {
            html += th();
            html += th(indent + get_formatted_date(filters.period_end_month, filters.to_fiscal_year, 0));
            html += th(blank_column);
            html += th(indent + 'YTD ' + filters.to_fiscal_year.toString().slice(-2));
            html += th(blank_column);
        } else if (mode == "balance_sheet") {
            html += '<tr></tr>';
            html += th();
            html += th();
            html += th(indent + filters.period_end_month + '&nbsp;' + date + ',&nbsp;' + filters.to_fiscal_year);
        }
    } else if (filters.report_type == "Regular" || filters.report_type == "Detailed")  {
        if (mode == "year_to_date") {
            html += th();
            html += th(indent + get_formatted_date(filters.period_end_month, filters.to_fiscal_year, 0));
            html += th(blank_column);
            html += th(indent + get_formatted_date(filters.period_end_month, filters.to_fiscal_year, 1));
            html += th(blank_column);
            html += th(indent + 'YTD ' + filters.to_fiscal_year.toString().slice(-2));
            html += th(blank_column);
            html += th(indent + 'YTD ' + (parseInt(filters.to_fiscal_year) - 1).toString().slice(-2));
            html += th(blank_column);
        } else if (mode == "trailing_12_months") {
            html += th();
            for(let i = 0; i < ttm_period.length; i++)
                html += th(indent + get_formatted_date(ttm_period[i], ttm_period[i], 0));
            html += th(indent + indent + 'Total');
            html += th(indent + indent + '%');
        } else if (mode == "balance_sheet") {
            html += th();
            html += th(indent + indent + get_formatted_date(filters.period_end_month, filters.to_fiscal_year, 0));
            html += th(indent + indent + get_formatted_date(filters.period_end_month, filters.to_fiscal_year, 1));
        }
    }
    html += '</tr>';
    html += '</thead>';
    
    return html;
}

// generates the table's rows
function generate_table_body(dataset, mode) {
    var html = ""; // holds the html that is returned

    global_total_income = get_total_income(dataset, mode);

    html += '<tbody>'; // start html table body

    if (filters.report_type == "Skinny") {
        if (mode == "year_to_date") {
            var amortization             = [0, 0];
            var interest                 = [0, 0];
            var tax_expense              = [0, 0];
            var net_income               = [0, 0];
            var total_income             = [0, 0];
            var gross_margin_values      = [0, 0];
            var income_before_taxes      = [0, 0];
            var total_other_expenses     = [0, 0];
            var total_other_income       = [0, 0];
            var total_operating_expenses = [0, 0];

            // global_total_income holds more than 2 values, so we only pick the ones we need
            total_income = [global_total_income[0], global_total_income[2]];
            html += '<tr></tr>';
            html += append_total_row("Income", total_income, mode, true);

            // gather print groups for Operating Expenses
            if (get_whether_category_exists(dataset, "Operating Expenses")) {
                var merged_print_groups = get_merged_print_groups("Operating Expenses", dataset, mode);

                // collect values from the print groups, accumulate into required categories
                for (let i = 0; i < merged_print_groups.length; i++) { 
                    if (merged_print_groups[i]["account"].includes("420 - Amortization")) {
                        amortization[0] += merged_print_groups[i]["curr_data"];
                        amortization[1] += merged_print_groups[i]["curr_ytd"];
                    } else if (merged_print_groups[i]["account"].includes("301 - Interest on Long Term Debt")) {
                        interest[0] += merged_print_groups[i]["curr_data"];
                        interest[1] += merged_print_groups[i]["curr_ytd"];
                    } else if (merged_print_groups[i]["account"].includes("500 - Income Taxes")) {
                        tax_expense[0] += merged_print_groups[i]["curr_data"];
                        tax_expense[1] += merged_print_groups[i]["curr_ytd"];
                    } else {
                        total_other_expenses[0] += merged_print_groups[i]["curr_data"];
                        total_other_expenses[1] += merged_print_groups[i]["curr_ytd"];
                    }
                    total_operating_expenses[0] += merged_print_groups[i]["curr_data"];
                    total_operating_expenses[1] += merged_print_groups[i]["curr_ytd"];
                }
            }

            // gather CoGS values
            if (get_whether_category_exists(dataset, "Cost of Goods Sold")) {
                gross_margin_values = get_gross_margin_values(dataset);
                gross_margin_values = [gross_margin_values[0], gross_margin_values[2]];
                html += append_cogs_section(dataset, mode);
            }

            // gather Other Income values
            if (get_whether_category_exists(dataset, "Other Income")) {
                total_other_income = get_category_total("Other Income", dataset, mode);
                total_other_income = [total_other_income[0], total_other_income[2]];
            }
            
            income_before_taxes = [
                gross_margin_values[0] + total_income[0] - total_operating_expenses[0],
                gross_margin_values[1] + total_income[1] - total_operating_expenses[1]
            ];

            net_income = [
                income_before_taxes[0] - tax_expense[0],
                income_before_taxes[1] - tax_expense[1],
            ];

            // append the Operating Expenses section
            html += append_group_row("Operating Expenses", false);
            html += append_data_row([], (indent + "Amortization Expenses"), amortization, mode);
            html += append_data_row([], (indent + "Interest Expenses"), interest, mode);
            html += append_data_row([], (indent + "Other Expenses"), total_other_expenses, mode);
            html += append_data_row([], ("Total Operating Expense"), total_operating_expenses, mode, "border-top: 1px solid black");
            html += '<tr></tr>';
            html += append_total_row("Other Income", total_income, mode);
            html += append_data_row([], ("Income Before Taxes"), income_before_taxes, mode, "border-top: 1px solid black");
            html += append_data_row([], ("Tax Expense"), tax_expense, mode, "border-bottom: 1px solid black;");
            html += append_data_row([], ('Net Income'), net_income, mode, "border-bottom: 1px double black; font-weight: bold;");
        } else if (mode == "balance_sheet") {

            if (skinny_bs_v1) {

                // -------------------------- ------ --------------------------
                // -------------------------- ASSETS --------------------------
                // -------------------------- ------ --------------------------

                html += append_group_row("Assets", true);
                html += append_group_row("Current", true);

                // append Current Assets
                if (get_whether_category_exists(dataset, "Current Assets"))
                    html += append_category_rows("Current Assets", dataset, mode, -1);
                
                // append Property Plant & Equipment
                var property_plant_equipment = [get_particular_print_group("5 - Property Plant & Equipment", dataset)[0]];
                html += append_data_row([], ("Property Plant & Equipment"), property_plant_equipment, mode, "font-weight: bold;", "font-weight: bold;");

                // append Goodwill
                html += '<tr></tr>';
                var property_plant_equipment = [get_particular_print_group("6 - Goodwill", dataset)[0]];
                html += append_data_row([], ("Goodwill"), property_plant_equipment, mode, "font-weight: bold;", "font-weight: bold;");

                // append Total Assets
                html += '<tr></tr>';
                var total_asset = [get_particular_print_group("Total Asset", dataset)[0]];
                html += append_data_row([], ("Total Assets"), total_asset, mode, "font-weight: bold; border-bottom: 1px double black; border-top: 1px solid black;", "font-weight: bold;");
                
                // ------------------------ ----------- ------------------------
                // ------------------------ LIABILITIES ------------------------
                // ------------------------ ----------- ------------------------

                html += '<tr></tr>';
                html += append_group_row("Liabilities", true);
                html += append_group_row("Current", true);
            
                var entries = [];
                var entries_total = 0;
                var temp = [];

                // ------------------------ current liabilities ------------------------
                temp = get_merged_print_groups("Accounts Payable", dataset, mode);
                for (let i = 0; i < temp.length; i++) 
                    entries.push(temp[i]);
                
                temp = get_merged_print_groups("Current Liabilities", dataset, mode);
                for (let i = 0; i < temp.length; i++) 
                    entries.push(temp[i]);

                temp = get_merged_print_groups("Duties and Taxes", dataset, mode);
                for (let i = 0; i < temp.length; i++) 
                    entries.push(temp[i]);

                entries = get_merged_dataset(entries);
                for (let i = 0; i < entries.length; i++) {
                    let start = (entries[i].account.indexOf("-")) + 2;
                    let title = indent + entries[i].account.slice(start);
                    entries_total += entries[i].curr_data;
                    html += append_data_row([], title, [entries[i].curr_data], mode);
                }
                html += append_total_row("Total Current Liabilities", [entries_total], mode);

                // ------------------------ long term liabilities ------------------------
                html += '<tr></tr>';
                html += append_group_row("Long Term", true);

                entries = [];
                entries_total = 0;

                entries = get_merged_print_groups("Long-Term Liabilities", dataset, mode);
                for (let i = 0; i < entries.length; i++) {
                    let start = (entries[i].account.indexOf("-")) + 2;
                    let title = indent + entries[i].account.slice(start);
                    entries_total += entries[i].curr_data;
                    html += append_data_row([], title, [entries[i].curr_data], mode);
                }
                html += append_total_row("Long-Term Liabilities", [entries_total], mode);
                html += append_equity_section(dataset);
            } else {
                let total_assets_object;
                let total_liabilities_object;

                for (let i = 0; i < dataset.length; i++) {
                    if (dataset[i].is_group) {
                        if (dataset[i].account == "Assets") {
                            total_assets_object = dataset[i];
                            html += append_group_row("Assets", true);
                        } else if (dataset[i].account == "Liabilities") {
                            total_liabilities_object = dataset[i]; 
                            html += append_total_row("Total Assets", [total_assets_object[curr_month_year]], mode);
                            html += '<tr></tr>';
                            html += append_group_row("Liabilities", true);
                        } else {
                            html += append_data_row([], get_formatted_name(dataset[i]), [dataset[i][curr_month_year]], mode);
                        }
                    }
                }
                html += append_total_row("Total Liabilities", [total_liabilities_object[curr_month_year]], mode);
                html += append_equity_section(dataset);
            }
        }
    } else if (filters.report_type == "Regular" || filters.report_type == "Detailed") {
        if (mode == "year_to_date" || mode == "trailing_12_months") {
            var total_expenses = [];

            html += append_group_row("Income", true);
            
            for (let i = 0; i < income_statement_categories.length; i++) {
                // Operating Expenses is the first category under Expenses, so we put the group header above it
                // this needs to be done before the rest of the category is appended since it's a header
                if (income_statement_categories[i] == "Operating Expenses")
                    html += append_group_row("Expenses", true);

                // for each category, append the rows under it and also append the total row
                if (get_whether_category_exists(dataset, income_statement_categories[i])) {
                    if (income_statement_categories[i] == "Other Expenses") {
                        html += append_category_rows(income_statement_categories[i], dataset, mode, /*indent offset*/ 0, /*exclude_income_taxes*/ true);
                        html += "<tr></tr>";
                    } else {
                        html += append_category_rows(income_statement_categories[i], dataset, mode);
                        html += "<tr></tr>";
                    }
                }

                // cost of goods sold gets appended right after Other Income
                if (income_statement_categories[i] == "Other Income") {
                    html += append_total_row("Income", global_total_income, mode, true);
                    html += "<tr></tr>";
                    if (get_whether_category_exists(dataset, "Cost of Goods Sold"))
                        html += append_cogs_section(dataset, mode);

                // Other Expenses is the final category, so Total Expenses needs to be appended underneath it
                } else if (income_statement_categories[i] == "Other Expenses") {
                    total_expenses = get_total_expenses(dataset, mode);
                    html += append_total_row("Expenses", total_expenses, mode, true);
                    html += "<tr></tr>";
                    html += "<tr></tr>";
                }
            }

            // subtract expenses from income and append Net Income Before Taxes
            let net_income_before_taxes = [];
            for (let i = 0; i < total_expenses.length; i++) 
                net_income_before_taxes.push(global_gross_profit[i] - total_expenses[i]);

            html += append_total_row("Net Income Before Taxes", net_income_before_taxes, mode, true, true);

            // append Income Taxes
            html += append_data_row([], (indent + "Income Taxes"), global_income_taxes, mode);
            html += "<tr></tr>";
            
            // subtract taxes from net income and append the Net Income
            let net_income = [];
            for (let i = 0; i < net_income_before_taxes.length; i++) 
                net_income.push(net_income_before_taxes[i] - global_income_taxes[i]);
            html += append_total_row("Net Income", net_income, mode, true, true);

        } else if (mode == "balance_sheet") {
            html += append_group_row("Assets", true);
            for (let i = 0; i < balance_sheet_categories.length; i++) {
                if (get_whether_category_exists(dataset, balance_sheet_categories[i]))
                    html += append_category_rows(balance_sheet_categories[i], dataset, mode);
                else
                    if (debug_output) 
                        console.log("[!] " + balance_sheet_categories[i] + " does not exists");

                if (balance_sheet_categories[i] == "Fixed Asset") {
                    for (let i = 0; i < dataset.length; i++) {
                        if (dataset[i]["account"] == "Assets") {
                            var total_assets = [
                                Math.round(dataset[i][curr_month_year]),
                                Math.round(dataset[i][prev_month_year])
                            ];

                            html += append_total_row("Assets", total_assets, mode, true);
                            break;
                        }
                    }
                    html += "<tr></tr>";
                    html += append_group_row("Liabilities", true);
                } 

                if (balance_sheet_categories[i] == "Long-Term Liabilities") {
                    for (let i = 0; i < dataset.length; i++) {
                        if (dataset[i]["account"] == "Liabilities") {
                            var total_liabilities = [
                                Math.round(dataset[i][curr_month_year]),
                                Math.round(dataset[i][prev_month_year])
                            ];

                            html += append_total_row("Liabilities", total_liabilities, mode, true);
                            break;
                        }
                    }
                }
            }
            html += append_equity_section(dataset);
        }
    }

    html += '</tbody>'; // end html table body

    return html;
}


// ============================================================================================================================================
// GETTER FUNCTIONS
// ============================================================================================================================================


// calculate the last celendar date in the given year's month 
function get_last_date(month, year) {
    var month_number = 0; // January
    
    if (month.slice(0, 3) == 'Feb')      month_number = 1;
    else if (month.slice(0, 3) == 'Mar') month_number = 2;
    else if (month.slice(0, 3) == 'Apr') month_number = 3;
    else if (month.slice(0, 3) == 'May') month_number = 4;
    else if (month.slice(0, 3) == 'Jun') month_number = 5;
    else if (month.slice(0, 3) == 'Jul') month_number = 6;
    else if (month.slice(0, 3) == 'Aug') month_number = 7;
    else if (month.slice(0, 3) == 'Sep') month_number = 8;
    else if (month.slice(0, 3) == 'Oct') month_number = 9;
    else if (month.slice(0, 3) == 'Nov') month_number = 10;
    else if (month.slice(0, 3) == 'Dec') month_number = 11;

    var date = new Date(year, month_number + 1, 0).getDate();

    return date.toString();
}

// formats the name of the account that's passed as arg // fixes capitalizations and removal of numbers
function get_formatted_name(account_object, indent_offset = 0) {
    var account = "";

    // add the indent in a loop 
    let indent_string = "";
    for (let i = 0; i < account_object["indent"] && i < 2 + indent_offset; i++)
        indent_string += indent;

    if (filters.report_type != "Detailed") {
        // check if the account field has the print group name, otherwise we print the account name
        // the split removes the number in front of the strings like "30 - Trade Sales" to "Trade Sales"
        if (account_object["account"] != "") {
            if (account_object["is_group"] == 0) {
                let start = account_object["account"].indexOf("-");
                account += account_object["account"].slice(start+2);
            } else {
                account += account_object["account"];
            }
        } else {
            if (account_object["account_name"]) {
                let start = account_object["account_name"].indexOf("-");
                account += account_object["account_name"].slice(start+2);
            } else {
                let start = account_object["account"].indexOf("-");
                account += account_object["account"].slice(start+2);
            }
        }

    } else {
        account = capitialize_each_word(account_object["account"]);
    }
    

    return indent_string + account;
}

// converts dates into the format "MMM YY" // offset substracts the number from the year
function get_formatted_date(month, year, offset) {
    return ("&nbsp;" + month.toString().slice(0, 3).toUpperCase() + " " + (parseInt(year.slice(-2)) - offset).toString());
}

// formats the arg number such that negative numbers are surrounded by brackets // i.e., -1 to (1)
function get_formatted_number(number) {
    if (minus_to_brackets) {
        var formatted_number = "";

        // check for minus sign and add brackets if found
        if (number.toString()[0] == "-")
            formatted_number = "&nbsp;(" + number.toString().slice(1) + ")";
        else
            formatted_number = number.toString();
    
        return formatted_number;
    } else {
        return number
    }
}

// arg must be in the format mmm_yyyy // returns an array containing the current mmm_yyyy and the preceding 11 months
function get_ttm_period(curr_month_year) {
    let curr_month = curr_month_year.slice(0, 3); // mmm
    let curr_year = curr_month_year.slice(4); // yyyy

    let month_names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let start_month = ""
    let start_year = parseInt(curr_year) - 1;

    let j = 0;
    while (month_names[j] != curr_month)
        j++;

    start_month = month_names[j++];

    let ttm_period = [];

    for (let i = j; i < (j+12); i++) {
        if (i > 1 && i % 12 == 0)
            start_year = parseInt(curr_year);

        ttm_period.push(month_names[i % 12] + "_" + start_year);
    }

    return ttm_period;
}

// calculates and returns an array of the total income broken into months
function get_total_income(dataset, mode) {
    if (debug_output) 
        console.log("--> entering get_total_income()");

    // values for:     [jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec, tot]
    var total_values  = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]; // array of totals
    var total_product = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    var total_other   = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

    if (get_whether_category_exists(dataset, "Product Sales"))
        var total_product = get_category_total("Product Sales", dataset, mode);

    if (get_whether_category_exists(dataset, "Other Income"))
        var total_other = get_category_total("Other Income", dataset, mode);

    if (mode == "year_to_date") {
        for (let i = 0; i < 4; i++)
            total_values[i] += (total_product[i] + total_other[i]);
    } else if (mode == "trailing_12_months") {
        for (let i = 0; i < total_values.length; i++)
            total_values[i] += (total_product[i] + total_other[i]);
    }

    if (debug_output) 
        console.log("<-- exiting get_total_income()");
    return total_values;
}

// calculates and returns an array of the total expenses broken into months
function get_total_expenses(dataset, mode) {
    // values for:     [jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec, tot]
    var total_values    = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]; // array of totals
    var total_operating = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    var total_other     = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

    if (get_whether_category_exists(dataset, "Operating Expenses"))
        var total_operating = get_category_total("Operating Expenses", dataset, mode);

    if (get_whether_category_exists(dataset, "Other Expenses"))
        var total_other = get_category_total("Other Expenses", dataset, mode, /*exclude_income_taxes*/ true);

    if (mode == "year_to_date") {
        for (let i = 0; i < 4; i++)
            total_values[i] += (total_operating[i] + total_other[i]);
    } else if (mode == "trailing_12_months") {
        for (let i = 0; i < total_values.length; i++)
            total_values[i] += (total_operating[i] + total_other[i]);
    }

    return total_values;
}

// returns a particular print group from the dataset
function get_particular_print_group(print_group_name, dataset) {
    var particular_print_group = [0.0, 0.0];

    for (let i = 0; i < dataset.length; i++) {
        if (dataset[i]["account"]) {
            if (dataset[i]["account"].includes(print_group_name)) {
                particular_print_group[0] += dataset[i][curr_month_year];
                particular_print_group[1] += dataset[i][prev_month_year];
            }
        }
    }

    return particular_print_group;
}

// combines duplicate print groups in the given category and accumulates their values
function get_merged_print_groups(category_name, dataset, mode) {
    let index = 0;
    let account = "";
    let print_groups = [];

    if (filters.report_type == "Detailed") {
        if (mode == "year_to_date") {
            // find the beginning of this category and keep the index
            while (dataset[index]["account"] != category_name && index < dataset.length) 
                index++;

            // we need to move to the next index because the current index is the header itself
            index++;

            // gather each row's data under the current category
            // also compresses the accounts based on print groups
            // if a print group already exists in print_groups[], sum up their values 
            // if it does not exist already, append that group to print_groups[] along with its data
            while (dataset[index]["parent_account"] == category_name) {
                // create an object containing the info and push() to print_groups[]
                if (category_name == "Other Expenses" && dataset[index]["account"].includes("Income Tax")) {
                    global_income_taxes = [
                        dataset[index][curr_month_year],
                        dataset[index][prev_month_year],
                        dataset[index]["total"],
                        dataset[index]["prev_year_total"],
                    ];

                    index++;
                    
                    // break the loop if no more rows exist in the source array
                    if (!dataset[index]) 
                        break;

                } else {
                    print_groups.push({
                        "account"   : dataset[index]["account_name"],
                        "curr_data" : dataset[index][curr_month_year],
                        "prev_data" : dataset[index][prev_month_year],
                        "curr_ytd"  : dataset[index]["total"],
                        "prev_ytd"  : dataset[index]["prev_year_total"],
                        "indent"    : dataset[index]["indent"],
                        "is_group"  : dataset[index]["is_group"]
                    });
                    
                    index++;
                    
                    // break the loop if no more rows exist in the source array
                    if (!dataset[index]) 
                        break;
                }
            }
        } else if (mode == "trailing_12_months") {
            // find the beginning of this category and keep the index
            while (dataset[index]["account"] != category_name && index < dataset.length) 
                index++;

            // we need to move to the next index because the current index is the header itself
            index++;

            while (dataset[index]["parent_account"] == category_name) {
                if (category_name == "Other Expenses" && dataset[index]["account"].includes("Income Tax")) {
                    global_income_taxes = [
                        dataset[index][ttm_period[0]],
                        dataset[index][ttm_period[1]],
                        dataset[index][ttm_period[2]],
                        dataset[index][ttm_period[3]],
                        dataset[index][ttm_period[4]],
                        dataset[index][ttm_period[5]],
                        dataset[index][ttm_period[6]],
                        dataset[index][ttm_period[7]],
                        dataset[index][ttm_period[8]],
                        dataset[index][ttm_period[9]],
                        dataset[index][ttm_period[10]],
                        dataset[index][ttm_period[11]],
                        dataset[index]["total"],
                    ];

                    index++;
                    
                    // break the loop if no more rows exist in the source array
                    if (!dataset[index]) 
                        break;

                } else {
                    print_groups.push({
                        "account"  : dataset[index]["account_name"],
                        "ttm_00"   : dataset[index][ttm_period[0]],
                        "ttm_01"   : dataset[index][ttm_period[1]],
                        "ttm_02"   : dataset[index][ttm_period[2]],
                        "ttm_03"   : dataset[index][ttm_period[3]],
                        "ttm_04"   : dataset[index][ttm_period[4]],
                        "ttm_05"   : dataset[index][ttm_period[5]],
                        "ttm_06"   : dataset[index][ttm_period[6]],
                        "ttm_07"   : dataset[index][ttm_period[7]],
                        "ttm_08"   : dataset[index][ttm_period[8]],
                        "ttm_09"   : dataset[index][ttm_period[9]],
                        "ttm_10"   : dataset[index][ttm_period[10]],
                        "ttm_11"   : dataset[index][ttm_period[11]],
                        "total"    : dataset[index]["total"],
                        "indent"   : dataset[index]["indent"],
                        "is_group" : dataset[index]["is_group"]
                    });
                    
                    index++;
                    
                    // break the loop if no more rows exist in the source array
                    if (!dataset[index]) 
                        break;
                }
            }
        } else if (mode == "balance_sheet") {
            // find the beginning of this category and keep the index
            while (dataset[index]["account"] != category_name && index < dataset.length)
                index++;

            // we need to move to the next index because the current index is the header itself
            index++;

            while (dataset[index]["parent_account"] == category_name) {
                if (dataset[index]["is_group"] == false) {
                    print_groups.push({
                        "account"   : dataset[index]["account_name"],
                        "curr_data" : dataset[index][curr_month_year],
                        "prev_data" : dataset[index][prev_month_year],
                        "indent"    : dataset[index]["indent"],
                        "is_group"  : dataset[index]["is_group"]
                    });
                }

                index++;
                
                // break the loop if no more rows exist in the source array
                if (!dataset[index]) 
                    break;
            }
        }
    } else if (filters.report_type == "Regular" || filters.report_type == "Skinny") {
        if (mode == "year_to_date") {
            // find the beginning of this category and keep the index
            while (dataset[index]["account"] != category_name && index < dataset.length) 
                index++;
            index++;

            while (dataset[index]["parent_account"] == category_name) {
                account = dataset[index]["account"];

                if (category_name == "Other Expenses" && account.includes("Income Tax")) {
                    global_income_taxes = [
                        dataset[index][curr_month_year],
                        dataset[index][prev_month_year],
                        dataset[index]["total"],
                        dataset[index]["prev_year_total"],
                    ];

                    index++;
                    
                    // break the loop if no more rows exist in the source array
                    if (!dataset[index]) 
                        break;

                } else {
                    // this section compares the current print group against existing print groups
                    let group_found = false;
                    for (let j = 0; j < print_groups.length; j++) {
                        if (print_groups[j].account == account) {
                            print_groups[j].curr_data += dataset[index][curr_month_year];
                            print_groups[j].prev_data += dataset[index][prev_month_year];
                            print_groups[j].curr_ytd  += dataset[index]["total"];
                            print_groups[j].prev_ytd  += dataset[index]["prev_year_total"];
                            print_groups[j].indent    =  dataset[index]["indent"];
                            print_groups[j].is_group  =  dataset[index]["is_group"];

                            group_found = true;
                            break;
                        }
                    }

                    // if the print group was not found, append it to the end
                    if (!group_found) {
                        // create an object containing the info and push() to print_groups[]
                        print_groups.push({
                            "account"   : account,
                            "curr_data" : dataset[index][curr_month_year],
                            "prev_data" : dataset[index][prev_month_year],
                            "curr_ytd"  : dataset[index]["total"],
                            "prev_ytd"  : dataset[index]["prev_year_total"],
                            "indent"    : dataset[index]["indent"],
                            "is_group"  : dataset[index]["is_group"]
                        });
                    }
                    
                    index++;
                    
                    // break the loop if no more rows exist in the source array
                    if (!dataset[index]) 
                        break;
                }
            }
        } else if (mode == "trailing_12_months") {
            // find the beginning of this category and keep the index
            while (dataset[index]["account"] != category_name && index < dataset.length) 
                index++;

            // we need to move to the next index because the current index is the header itself
            index++;

            while (dataset[index]["parent_account"] == category_name) {
                account = dataset[index]["account"];

                if (category_name == "Other Expenses" && account.includes("Income Tax")) {
                    global_income_taxes = [
                        dataset[index][ttm_period[0]],
                        dataset[index][ttm_period[1]],
                        dataset[index][ttm_period[2]],
                        dataset[index][ttm_period[3]],
                        dataset[index][ttm_period[4]],
                        dataset[index][ttm_period[5]],
                        dataset[index][ttm_period[6]],
                        dataset[index][ttm_period[7]],
                        dataset[index][ttm_period[8]],
                        dataset[index][ttm_period[9]],
                        dataset[index][ttm_period[10]],
                        dataset[index][ttm_period[11]],
                        dataset[index]["total"],
                    ];

                    index++;
                    
                    // break the loop if no more rows exist in the source array
                    if (!dataset[index]) 
                        break;

                } else {
                    // this section compares the current print group against existing print groups
                    let group_found = false;
                    for (let j = 0; j < print_groups.length; j++) {
                        if (print_groups[j].account == account) {
                            print_groups[j]["ttm_00"]   += dataset[index][ttm_period[0]],
                            print_groups[j]["ttm_01"]   += dataset[index][ttm_period[1]],
                            print_groups[j]["ttm_02"]   += dataset[index][ttm_period[2]],
                            print_groups[j]["ttm_03"]   += dataset[index][ttm_period[3]],
                            print_groups[j]["ttm_04"]   += dataset[index][ttm_period[4]],
                            print_groups[j]["ttm_05"]   += dataset[index][ttm_period[5]],
                            print_groups[j]["ttm_06"]   += dataset[index][ttm_period[6]],
                            print_groups[j]["ttm_07"]   += dataset[index][ttm_period[7]],
                            print_groups[j]["ttm_08"]   += dataset[index][ttm_period[8]],
                            print_groups[j]["ttm_09"]   += dataset[index][ttm_period[9]],
                            print_groups[j]["ttm_10"]   += dataset[index][ttm_period[10]],
                            print_groups[j]["ttm_11"]   += dataset[index][ttm_period[11]],
                            print_groups[j]["total"]    += dataset[index]["total"];
                            print_groups[j]["indent"]   =  dataset[index]["indent"];
                            print_groups[j]["is_group"] =  dataset[index]["is_group"];

                            group_found = true;
                            break;
                        }
                    }

                    // if the print group was not found, append it to the end
                    if (!group_found) {
                        // create an object containing the info and push() to print_groups[]
                        print_groups.push({
                            "account"  : account,
                            "ttm_00"   : dataset[index][ttm_period[0]],
                            "ttm_01"   : dataset[index][ttm_period[1]],
                            "ttm_02"   : dataset[index][ttm_period[2]],
                            "ttm_03"   : dataset[index][ttm_period[3]],
                            "ttm_04"   : dataset[index][ttm_period[4]],
                            "ttm_05"   : dataset[index][ttm_period[5]],
                            "ttm_06"   : dataset[index][ttm_period[6]],
                            "ttm_07"   : dataset[index][ttm_period[7]],
                            "ttm_08"   : dataset[index][ttm_period[8]],
                            "ttm_09"   : dataset[index][ttm_period[9]],
                            "ttm_10"   : dataset[index][ttm_period[10]],
                            "ttm_11"   : dataset[index][ttm_period[11]],
                            "total"    : dataset[index]["total"],
                            "indent"   : dataset[index]["indent"],
                            "is_group" : dataset[index]["is_group"]
                        });
                    }
                    
                    index++;
                    
                    // break the loop if no more rows exist in the source array
                    if (!dataset[index]) 
                        break;
                }
            }
        } else if (mode == "balance_sheet") {
            // find the beginning of this category and keep the index
            while (dataset[index]["account"] != category_name && index < dataset.length)
                index++;

            // we need to move to the next index because the current index is the header itself
            index++;

            while (dataset[index]["parent_account"] == category_name) {
                if (dataset[index]["is_group"] == false) {
                    account = dataset[index]["account"];

                    // this section compares the current print group against existing print groups
                    let group_found = false;
                    for (let j = 0; j < print_groups.length; j++) {
                        if (print_groups[j].account == account) {
                            print_groups[j].curr_data += dataset[index][curr_month_year];
                            print_groups[j].prev_data += dataset[index][prev_month_year];
                            print_groups[j].indent    =  dataset[index]["indent"];
                            print_groups[j].is_group  =  dataset[index]["is_group"];

                            group_found = true;
                            break;
                        }
                    }

                    // if the print group was not found, append it to the end
                    if (!group_found) {
                        // create an object containing the info and push() to print_groups[]
                        print_groups.push({
                            "account"   : account,
                            "curr_data" : dataset[index][curr_month_year],
                            "prev_data" : dataset[index][prev_month_year],
                            "indent"    : dataset[index]["indent"],
                            "is_group"  : dataset[index]["is_group"]
                        });
                    }
                }

                index++;
                
                // break the loop if no more rows exist in the source array
                if (!dataset[index]) 
                    break;
            }
        }
    }

    return print_groups;
}

// merges the print groups in the given dataset
function get_merged_dataset(dataset) {
    let merged_dataset = [];

    for (let i = 0; i < dataset.length; i++) {
        let curr_account = dataset[i]["account"];
        let match = false;

        for (let j = 0; j < merged_dataset.length; j++) {
            if (curr_account == merged_dataset[j]["account"]) {
                merged_dataset[j].curr_data += dataset[i]["curr_data"];
                merged_dataset[j].prev_data += dataset[i]["prev_data"];

                match = true;
                break;
            }
        }

        if (!match) {
            merged_dataset.push({
                "account"   : curr_account,
                "curr_data" : dataset[i]["curr_data"],
                "prev_data" : dataset[i]["prev_data"],
                "indent"    : dataset[i]["indent"],
                "is_group"  : dataset[i]["is_group"]
            });
        }
    }

    return merged_dataset;
}

// finds the total amount per year based on the category name passed // switch between modes using the "trailing_12_months" boolean
function get_category_total(category_name, dataset, mode, exclude_income_taxes = false) {
    if (debug_output) 
        console.log("\t[" + category_name + "] calculating total");

    // values for:     [curr, prev, curr_ytd, prev_ytd] <- ytd
    // values for:     [jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec, tot] <- ttm
    var total_values = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]; // array of totals
    var index = 0;
    
    // find the beginning of this category and keep the index
    while (dataset[index]["account"] != category_name && index < dataset.length) 
        index++;
    index++;

    var current_indent = dataset[index]["indent"];
    
    if (mode == "year_to_date") {
        // everything under this subgroup is summed together into the array
        while (dataset[index]["indent"] == current_indent && index < dataset.length) {

            if (!(exclude_income_taxes && dataset[index]["account"].includes("Income Tax"))) {
                total_values[0] += dataset[index][curr_month_year];
                total_values[1] += dataset[index][prev_month_year];
                total_values[2] += dataset[index]["total"];
                total_values[3] += dataset[index]["prev_year_total"];
            }
            index++;
    
            // break if end of array
            if (!dataset[index])
                break;
        }
    } else if (mode == "trailing_12_months") {
        while (dataset[index]["indent"] == current_indent && index < dataset.length) {

            if (!(exclude_income_taxes && dataset[index]["account"].includes("Income Tax")))
                for (let k = 0; k < total_values.length - 1; k++)
                    total_values[k] += dataset[index][ttm_period[k]];

            total_values[12] += dataset[index]["total"];

            index++;

            // break if end of array
            if (!dataset[index])
                break;
        }
    } else if (mode == "balance_sheet") {
        while (dataset[index]["indent"] == current_indent && index < dataset.length) {
            if (dataset[index]["is_group"] == false) {
                total_values[0] += dataset[index][curr_month_year];
                total_values[1] += dataset[index][prev_month_year];
            }
            index++;

            // break if end of array
            if (!dataset[index])
                break;
        }
    }
    
    // round down all the values before returning the array
    for (let j = 0; j < total_values.length; j++)
        number_format.format(Math.round(total_values[j]));
    
    if (debug_output) 
        console.log("\t[" + category_name + "] total calculated (" + mode + ")");

    return total_values;
}

// send the entire array as "dataset" // checks if the category passed as "category_name" exists in the dataset
function get_whether_category_exists(dataset, category_name) {
    var get_whether_category_exists = false;

    for (let i = 0; i < dataset.length; i++) {
        if (dataset[i]["account"]) {
            if (dataset[i]["account"].slice(0, category_name.length) == category_name){
                get_whether_category_exists = true;
                break;
            }
        }
    }

    if (debug_output) 
        if (get_whether_category_exists) 
            console.log(category_name + " exists");
        else
            console.log(category_name + " does not exists");
    

    return get_whether_category_exists;
}

//
function get_gross_margin_values(dataset) {
    var total_income = global_total_income;
    var total_cogs = [];
    var gross_margins = [];

    for (let i = 0; i < dataset.length; i++) {
        if (dataset[i]["account"] == "Cost of Goods Sold") {
            var total_cogs = [
                dataset[i][curr_month_year],
                dataset[i][prev_month_year],
                dataset[i]["total"],
                dataset[i]["prev_year_total"]
            ];
            break;
        }
    }

    for (let i = 0; i < 4; i++)
        gross_margins.push(total_income[i] - total_cogs[i]);

    return gross_margins;
}


// ============================================================================================================================================
// APPEND FUNCTIONS
// ============================================================================================================================================


// compresses and returns the rows as print_groups[] that fall under the "catergory_name" arg // switch between modes using the mode param
function append_category_rows(category_name, dataset, mode, indent_offset = 0, exclude_income_taxes = false) {
    if (debug_output) 
        console.log("\t[" + category_name + "] getting rows");

    let index = 0;
    let html = "";
    let account = "";
    let merged_print_groups = get_merged_print_groups(category_name, dataset, mode);
    let category_total = [];

    if (exclude_income_taxes) 
        category_total = get_category_total(category_name, dataset, mode, /* exclude_income_taxes = */ true);
    else
        category_total = get_category_total(category_name, dataset, mode);

    // find the beginning of this category and keep the index
    while (dataset[index]["account"] != category_name && index < dataset.length) 
        index++;

    // append the group header before the rest of the rows
    if (!(filters.report_type == "Skinny" && mode == "balance_sheet"))
        html += append_group_row(get_formatted_name(dataset[index], indent_offset));

    // we need to move to the next index because the current index is the header itself
    index++;

    if (filters.report_type == "Regular" || filters.report_type == "Detailed")  {
        if (mode == "year_to_date") {
            var data = [];
            // adds each row's gathered data to the html
            for (let i = 0; i < merged_print_groups.length; i++) {
                account = get_formatted_name(merged_print_groups[i], indent_offset);
    
                data = [
                    merged_print_groups[i].curr_data,
                    merged_print_groups[i].prev_data,
                    merged_print_groups[i].curr_ytd,
                    merged_print_groups[i].prev_ytd
                ];
    
                // if (!(account.includes("Income Tax"))) 
                html += append_data_row(category_total, account, data, mode);
            }
        
            // appends a row containing the total values for the current category
            html += append_total_row(category_name, category_total, mode);
    
        } else if (mode == "trailing_12_months") {
            var data = [];
            // adds each row's gathered data to the html
            for (let i = 0; i < merged_print_groups.length; i++) {
                account = get_formatted_name(merged_print_groups[i], indent_offset);
    
                data = [];
                for (let k = 0; k < 12; k++) 
                    data.push(merged_print_groups[i]["ttm_" + (k).toString().padStart(2,0)]); // ttm_00, ... , ttm_11 
                data.push(merged_print_groups[i]["total"]);
    
                // if (!(account.includes("Income Tax")))
                html += append_data_row(category_total, account, data, mode);
            }
    
            // appends a row containing the total values for the current category
            html += append_total_row(category_name, category_total, mode);
        } else if (mode == "balance_sheet") {
            var data = [];
            // adds each row's gathered data to the html
            for (let i = 0; i < merged_print_groups.length; i++) {
                account = get_formatted_name(merged_print_groups[i], indent_offset);
    
                data = [
                    Math.round(merged_print_groups[i].curr_data),
                    Math.round(merged_print_groups[i].prev_data),
                ];
    
                html += append_data_row(category_total, account, data, mode);
            }
        
            // appends a row containing the total values for the current category
            html += append_total_row(category_name, category_total, mode) + "<tr></tr>";
        }
    } else if (filters.report_type == "Skinny") {
        if (mode == "balance_sheet") {
            var data = [];
            // adds each row's gathered data to the html
            for (let i = 0; i < merged_print_groups.length; i++) {
                account = get_formatted_name(merged_print_groups[i], indent_offset);
                data = [merged_print_groups[i].curr_data];
                html += append_data_row(category_total, account, data, mode);
            }
        
            // appends a row containing the total values for the current category
            html += append_total_row(category_name, category_total, mode) + "<tr></tr>";
        }
    } 

    if (debug_output) 
        console.log(" --> got rows for " + category_name);

    return html;
}

// appends the name that is passed as argument // no data is appended -- used for headers and such
function append_group_row(account, is_root = false, inline_css = "") {
    var html = "";

    html += '<tr>';
    if (is_root)
        html += '<td style="font-weight: bold; font-size: 10pt; ' + inline_css + '" colspan=1>' + account.toUpperCase() + '</td>';
    else
        html += '<td style="font-size: 10pt; ' + inline_css + '" colspan=1>' + account + '</td>';
    html += '</tr>';

    return html
}

// appends each row's data (used inside append_category_rows()), along with the percentage // switch between modes using the "trailing_12_months" boolean
function append_data_row(total_array, account, data, mode, inline_css_data = "", inline_css_account = "") {
    var html = "";
    var values = [];
    var percentages = [];

    html += '<tr>';
 
    if (filters.report_type == "Skinny") {
        html += '<td style="font-size: 10pt; ' + inline_css_account + '" colspan=1>' + account + '</td>';

        if (mode == "balance_sheet") 
            html += '<td colspan=1></td>';

        for (let i = 0; i < data.length; i++) {
            html += '<td style="font-size: 10pt; ' + inline_css_data + '" colspan=1>' + (number_format.format(Math.round(data[i]))) + '</td>';
            html += "<td></td>";
        }
    } else if (filters.report_type == "Regular" || filters.report_type == "Detailed") {
        if (mode == "year_to_date") {
            for (let i = 0; i < data.length; i++) {
                values.push((number_format.format(Math.round(data[i]))));
                Math.round(data[i]) == 0 ? percentages.push("0%") : percentages.push(get_formatted_number(((data[i] * 100) / global_total_income[i]).toFixed(2)) + "%");
            }

            html += '<td style="font-size: 10pt; white-space: nowrap;" colspan=1>' + account + '</td>';
            for (let i = 0; i < 4; i++) {
                html += '<td style="text-align: right; font-size: 10pt" colspan=1>' + get_formatted_number(values[i]) + '</td>';
                html += '<td style="text-align: right; font-size: 10pt" colspan=1>' + validate_number(percentages[i]) + '</td>';
            }
        } else if (mode == "trailing_12_months") {
            for (let i = 0; i < data.length; i++)			
                values.push((number_format.format(Math.round(data[i])))); // round down and format the number to 2 decimal places

            // get_formatted_number() replaces minus symbols with brackets when it the global flag is true
            let percentage = (get_formatted_number(((data[data.length - 1] * 100) / global_total_income[total_array.length - 1]).toFixed(2)) + "%");

            html += '<td style="font-size: 10pt; white-space: nowrap;" colspan=1>' + account + indent + indent + indent + indent + '</td>';
            for (let i = 0; i < data.length; i++)
                html += '<td style="text-align: right; font-size: 10pt" colspan=1>' + get_formatted_number(values[i]) + '</td>';
            html += '<td style="text-align: right; font-size: 10pt" colspan=1>' + validate_number(percentage) + '</td>';

        } else if (mode == "balance_sheet") {
            html += '<td style="font-size: 10pt; white-space: nowrap;" colspan=1>' + account + '</td>';
            html += '<td style="font-size: 10pt" colspan=1>' + (number_format.format(Math.round(data[0]))) + '</td>';
            html += '<td style="font-size: 10pt" colspan=1>' + (number_format.format(Math.round(data[1]))) + '</td>';
        }
    }
    html += '</tr>';
        
    return html;
}

// appends the category's data under each year (used inside append_category_rows()), along with the percentage // switch between modes using the "trailing_12_months" boolean
function append_total_row(category_name, category_total, mode, is_root = false, is_custom = false) { 
    if (debug_output) 
        console.log("\t\tAppending " + category_name);

    var html = "";
    var values = [];
    var percentages = [];

    for(let i = 0; i < category_total.length; i++) {
        values.push(number_format.format(Math.round(category_total[i])));
        Math.round(category_total[i]) == 0 ? percentages.push("0%") : percentages.push(get_formatted_number(((category_total[i] * 100) / global_total_income[i]).toFixed(2)) + "%");
    }

    html += '<tr>';
    if (filters.report_type == "Skinny") {
        if (mode == "year_to_date") {
            html += '<td style="font-size: 10pt" colspan=1>' + category_name + '</td>';

            for (let i = 0; i < values.length; i++) {
                html += '<td style="font-size: 10pt;" colspan=1>' + values[i] + '</td>';
                html += "<td></td>";
            }
        } else if (mode == "balance_sheet") {
            html += '<td style="font-size: 10pt" colspan=1>' + category_name + '</td>';
            html += '<td colspan=1></td>';
            html += '<td style="font-size: 10pt; border-top: 1px solid" colspan=1>' + values[0] + '</td>';
            html += "<td></td>";
        }

    } else {
        if (is_root) {
            html += '<tr style="border-top: 1px solid black; border-bottom: 3px solid black">';
            html += '<td style="font-weight: bold; font-size: 10pt" colspan=1>' + (is_custom ? (category_name.toUpperCase()) : ('TOTAL ' + category_name.toUpperCase())) + '</td>';
        } else {
            html += '<tr style="border-top: 1px solid black">';
            html += '<td style="font-size: 10pt" colspan=1>' + (is_custom ? (indent + category_name) : (indent + 'Total ' + category_name)) + '</td>';
        }

        if (mode == "year_to_date") {
            for (let i = 0; i < 4; i++) {
                html += '<td style="font-size: 10pt" colspan=1>' + values[i] + '</td>';
                html += '<td style="text-align: right; font-size: 10pt" colspan=1>' + validate_number(percentages[i]) + '</td>';
            }
        } else if (mode == "trailing_12_months") {
            for (let i = 0; i < category_total.length; i++)
                html += '<td style="font-size: 10pt" colspan=1>' + values[i] + '</td>';
            html += '<td style="font-size: 10pt" colspan=1>100%</td>';
        } else if (mode == "balance_sheet") {
            for (let i = 0; i < 2; i++)
                html += '<td style="font-size: 10pt" colspan=1>' + values[i] + '</td>';
        }
    }
    html += '</tr>';

    if (debug_output) 
        console.log("\t\tAppended " + category_name);

    return html;
}

// appends the Equity section at the bottom of the Balance Sheet
function append_equity_section(dataset) {
    let html = "";
    let provisional = "Provisional Profit / Loss (Credit)";
    let equity = "Total (Credit)";

    html += "<tr></tr>";
    html += append_group_row("Equity", true)

    if (filters.report_type == "Regular" || filters.report_type == "Detailed") {
        for (let i = 0; i < dataset.length; i++) {
            if (dataset[i]["account"]) {
                if (dataset[i]["account"].includes(provisional)) {
                    html += '<tr>';
                    html += '<td style="font-weight: normal; font-size: 10pt" colspan=1>' + indent + 'Retained Earnings' + '</td>';
                    html += '<td style="font-size: 10pt" colspan=1>' + number_format.format(Math.round(dataset[i][curr_month_year])) + '</td>';
                    html += '<td style="font-size: 10pt" colspan=1>' + number_format.format(Math.round(dataset[i][prev_month_year])) + '</td>';
                    html += '</tr>';
                } else if (dataset[i]["account"].includes(equity)) {
                    html += '<tr style="border-top: 1px solid black; border-bottom: 3px solid black">';
                    html += '<td style="font-weight: bold; font-size: 10pt" colspan=1>' + ('Total Liabilities and Equity').toUpperCase() + '</td>';
                    html += '<td style="font-size: 10pt" colspan=1>' + number_format.format(Math.round(dataset[i][curr_month_year])) + '</td>';
                    html += '<td style="font-size: 10pt" colspan=1>' + number_format.format(Math.round(dataset[i][prev_month_year])) + '</td>';
                    html += '</tr>';
                }  
            }
        }
    } else if (filters.report_type == "Skinny") {
        for (let i = 0; i < dataset.length; i++) {
            if (dataset[i]["account"]) {
                if (dataset[i]["account"].includes(provisional)) {
                    html += '<tr>';
                    html += '<td style="font-weight: normal; font-size: 10pt" colspan=1>' + indent + 'Retained Earnings' + '</td>';
                    html += '<td colspan=1></td>';
                    html += '<td style="font-size: 10pt" colspan=1>' + number_format.format(Math.round(dataset[i][curr_month_year])) + '</td>';
                    html += '</tr>';
                } else if (dataset[i]["account"].includes(equity)) {
                    html += '<tr style="border-top: 1px solid black; border-bottom: 3px solid black">';
                    html += '<td style="font-weight: bold; font-size: 10pt" colspan=1>' + ('Total Liabilities and Equity').toUpperCase() + '</td>';
                    html += '<td colspan=1></td>';
                    html += '<td style="font-size: 10pt" colspan=1>' + number_format.format(Math.round(dataset[i][curr_month_year])) + '</td>';
                    html += '</tr>';
                }  
            }
        }
    }

    return html
}

// appends the CoGS and the Gross Margin rows
function append_cogs_section(dataset, mode) {
    var html = "";
    var total_income = global_total_income;
    var total_cogs = [];
    var gross_margins = [];
    var percentages = [];
    var cogs_percentages = [];

    for (let i = 0; i < dataset.length; i++) {
        if (dataset[i]["account"] == "Cost of Goods Sold") {
            total_cogs = [
                dataset[i][curr_month_year],
                dataset[i][prev_month_year],
                dataset[i]["total"],
                dataset[i]["prev_year_total"]
            ];

            break;
        }
    }

    for (let i = 0; i < 4; i++) {
        global_gross_profit.push(total_income[i] - total_cogs[i]);

        if (total_income[i] == 0) {
            percentages.push(0);
            cogs_percentages.push(0);
        } else {
            percentages.push(((global_gross_profit[i]) / total_income[i]) * 100);
            cogs_percentages.push((total_cogs[i] / total_income[i]) * 100);
        }
    }

    for (let i = 0; i < 4; i++) {
        total_cogs[i]       = number_format.format(Math.round(total_cogs[i])).toString();
        gross_margins[i]    = number_format.format(Math.round(global_gross_profit[i])).toString();
        percentages[i]      = percentages[i].toString() + "%";
        cogs_percentages[i] = cogs_percentages[i].toString() + "%";
    }

    if (filters.report_type == "Skinny") {

        html += '<tr>';
        html += '<td style="font-size: 10pt" colspan=1>Cost of Goods Sold</td>';
        html += '<td style="font-size: 10pt; text-align: right;" colspan=1>' + total_cogs[0] + '</td>';
        html += "<td></td>";
        html += '<td style="font-size: 10pt; text-align: right;" colspan=1>' + total_cogs[2] + '</td>';
        html += '</tr>';

        html += '<tr>';
        html += '<td style="font-size: 10pt" colspan=1>Gross Margin</td>';
        html += '<td style="font-size: 10pt; text-align: right; border-top: 1px solid black" colspan=1>' + gross_margins[0] + '</td>';
        html += "<td></td>";
        html += '<td style="font-size: 10pt; text-align: right; border-top: 1px solid black" colspan=1>' + gross_margins[2] + '</td>';
        html += '</tr>';
        html += '<tr></tr>';

    } else if (filters.report_type == "Regular" || filters.report_type == "Detailed") {
        if (mode == "year_to_date") {
    
            html += '<tr>';
            html += '<td style="font-size: 10pt" colspan=1><b>Cost of Goods Sold<b></td>';
            for (let i = 0; i < 4; i++) {
                html += '<td style="font-size: 10pt; text-align: right;" colspan=1>' + total_cogs[i] + '</td>';
                html += '<td style="font-size: 10pt; text-align: right;" colspan=1>' + cogs_percentages[i] + '</td>';
            }
            html += '</tr>';
    
            html += '<tr style="border-top: 1px solid black">';
            html += '<td style="font-size: 10pt" colspan=1><b>Gross Margin<b></td>';
            for (let i = 0; i < 4; i++) {
                html += '<td style="font-size: 10pt; text-align: right;" colspan=1>' + gross_margins[i] + '</td>';
                html += '<td style="font-size: 10pt; text-align: right;" colspan=1>' + percentages[i] + '</td>';
            }
            html += '</tr>';
            html += '<tr></tr>';

        } else if (mode == "trailing_12_months") {
            for (let i = 0; i < dataset.length; i++) {
                if (dataset[i]["account"] == "Cost of Goods Sold") {
                    total_cogs = [
                        (dataset[i][ttm_period[0]]),
                        (dataset[i][ttm_period[1]]),
                        (dataset[i][ttm_period[2]]),
                        (dataset[i][ttm_period[3]]),
                        (dataset[i][ttm_period[4]]),
                        (dataset[i][ttm_period[5]]),
                        (dataset[i][ttm_period[6]]),
                        (dataset[i][ttm_period[7]]),
                        (dataset[i][ttm_period[8]]),
                        (dataset[i][ttm_period[9]]),
                        (dataset[i][ttm_period[10]]),
                        (dataset[i][ttm_period[11]]),
                        (dataset[i]["total"])
                    ];

                    break;
                }
            }

            for (let i = 0; i < total_cogs.length; i++)
                global_gross_profit.push(total_income[i] - total_cogs[i]);

            percentages = [((global_gross_profit[12]/total_income[12]) * 100) + "%"];
            cogs_percentages = [((total_cogs[12]/total_income[12]) * 100) + "%"];

            html += '<tr>';
            html += '<td style="font-size: 10pt" colspan=1><b>Cost of Goods Sold<b></td>';
            for (let i = 0; i < total_cogs.length; i++)
                html += '<td style="font-size: 10pt; text-align: right;" colspan=1>' + number_format.format(total_cogs[i]) + '</td>';
            html += '<td style="font-size: 10pt; text-align: right;" colspan=1>' + cogs_percentages[0] + '</td>';
            html += '</tr>';
    
            html += '<tr style="border-top: 1px solid black">';
            html += '<td style="font-size: 10pt" colspan=1><b>Gross Margin<b></td>';
            for (let i = 0; i < total_cogs.length; i++)
                html += '<td style="font-size: 10pt; text-align: right;" colspan=1>' + number_format.format(global_gross_profit[i]) + '</td>';
            html += '<td style="font-size: 10pt; text-align: right;" colspan=1>' + percentages[0] + '</td>';
            html += '</tr>';
            html += '<tr></tr>';
        }
    }

    return html;
}


// ============================================================================================================================================
// SUPPORTING FUNCTIONS
// ============================================================================================================================================


// assign names to each sheet based on cost center // exports the excel file
const tables_to_excel = (function () {
    var uri = 'data:application/vnd.ms-excel;base64,',
    
    html_start = (
        `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">`
    ),
    
    template_ExcelWorksheet = (
        `<x:ExcelWorksheet><x:Name>{SheetName}</x:Name><x:WorksheetSource HRef="sheet{SheetIndex}.htm"/></x:ExcelWorksheet>`
    ),
    
    template_HTMLWorksheet = (`
------=_NextPart_dummy 
Content-Location: sheet{SheetIndex}.htm
Content-Type: text/html; charset=windows-1252

` + html_start + `
<head>
<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">
<link id="Main-File" rel="Main-File" href="../WorkBook.htm">
<link rel="File-List" href="filelist.xml">
</head>
<body><table>{SheetContent}</table></body>
</html>`
    ),

    template_WorkBook = (`MIME-Version: 1.0
X-Document-Type: Workbook
Content-Type: multipart/related; boundary="----=_NextPart_dummy"

------=_NextPart_dummy
Content-Location: WorkBook.htm
Content-Type: text/html; charset=windows-1252

` + html_start + `
<head>
<meta name="Excel Workbook Frameset">
<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">
<link rel="File-List" href="filelist.xml">
<!--[if gte mso 9]><xml>
<x:ExcelWorkbook>
<x:ExcelWorksheets>{ExcelWorksheets}</x:ExcelWorksheets>
<x:ActiveSheet>0</x:ActiveSheet>
</x:ExcelWorkbook>
</xml><![endif]-->
</head>
<frameset>
<frame src="sheet0.htm" name="frSheet">
<noframes><body><p>This page uses frames, but your browser does not support them.</p></body></noframes>
</frameset>
</html>
{HTMLWorksheets}
Content-Location: filelist.xml
Content-Type: text/xml; charset="utf-8"

<xml xmlns:o="urn:schemas-microsoft-com:office:office">
<o:MainFile HRef="../WorkBook.htm"/>
{ListWorksheets}
<o:File HRef="filelist.xml"/>
</xml>
------=_NextPart_dummy--
`
    ),

    base64 = function (s) { 
        return window.btoa(unescape(encodeURIComponent(s))) 
    },

    format = function (s, c) {
        return s.replace(/{(\w+)}/g, function (m, p) { 
            return c[p]; 
        }) 
    }
    
    return function (tables, filename, center_numbers) {
        var context_WorkBook = {
            ExcelWorksheets: '',
            HTMLWorksheets: '',
        };

        var tables = jQuery(tables);

        $.each(tables, function (SheetIndex, val) {
            var $table = $(val);
            var SheetName = "";
            let center_number = center_numbers[SheetIndex];

            switch (center_number) {
                case '0_IS': SheetName = "IS - Consolidated"; break;
                case '1_IS': SheetName = "IS - White-Wood Corporate"; break;
                case '2_IS': SheetName = "IS - White-Wood Distributors"; break;
                case '3_IS': SheetName = "IS - Forest Products"; break;
                case '6_IS': SheetName = "IS - Endeavours"; break;

                case '0_TTM': SheetName = "TTM - Consolidated"; break;
                case '1_TTM': SheetName = "TTM - White-Wood Corporate"; break;
                case '2_TTM': SheetName = "TTM - White-Wood Distributors"; break;
                case '3_TTM': SheetName = "TTM - Forest Products"; break;
                case '6_TTM': SheetName = "TTM - Endeavours"; break;
                
                case '0_BS': SheetName = "BS - Consolidated"; break;

                default: SheetName = "Sheet"; break;
            }
            
            context_WorkBook.ExcelWorksheets += format(template_ExcelWorksheet, {
                SheetIndex: SheetIndex,
                SheetName: SheetName
            });
            
            context_WorkBook.HTMLWorksheets += format(template_HTMLWorksheet, {
                SheetIndex: SheetIndex,
                SheetContent: $table.html()
            });
        });

        var link = document.createElement("A");
        link.href = uri + base64(format(template_WorkBook, context_WorkBook));
        link.download = filename || 'Workbook.xls';
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();		
        document.body.removeChild(link);

        download_success = true;
    }
})();

// wait for the given amount of milliseconds
function wait(ms) {
    const start = Date.now();
    let now = start;

    while (now - start < ms)
        now = Date.now();
}

// return a string with each word capitalized
function capitialize_each_word(word) {
    text = word.toLowerCase();
    text = text.split(" ").map((e) => e.charAt(0).toUpperCase() + e.substring(1)).join(" "); // process each word
    text = text.split("-").map((e) => e.charAt(0).toUpperCase() + e.substring(1)).join("-"); // process hyphens

    return text;
}

// replace invalid numbers or add formatting
function validate_number(number) {
    try {
        if (number.includes("NaN") || number.includes("100.00") || number.includes("Infinity"))
            return "100%";
        else if (number.toString().slice(0, -1) == "0.00")
            return "0%";
        else
            return number;
    } catch(err) {}
}

// so that I can just click export without filling in filters
function test_run() {
    filters.cost_center = [
        '01 - White-Wood Corporate - WW',
        '02 - White-Wood Distributors Winnipeg - WW',
        '03 - Forest Products - WW',
        '06 - Endeavours - WW',
    ];

    filters.report_type = "Detailed";
    // filters.report_type = "Skinny";
    
    for (let i = 0; i < test_dataset[0].length; i+=2) {
        _dataset.push(test_dataset[0][i]);
        _dataset.push(remove_blank_entries(test_dataset[0][i+1]));
    }
    generate_report([_dataset]);
}

var test_dataset = [{}];