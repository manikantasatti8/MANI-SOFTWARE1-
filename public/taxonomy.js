/* Department > Group of Risk > Class of Risk > Sub Class. Edit here and every form follows. */
const TAX={
 'Medical':{'Health & Medical':{
   'Group Medical':['SME Group Medical','Corporate Group Medical'],
   'Individual Medical':['Individual Medical','Family Medical','Domestic Helper Medical','Retiree Medical']}},
 'Motor':{
  'Motor':{'Motor Comprehensive':['Private Vehicle Comprehensive','Commercial Vehicle Comprehensive','Fleet Comprehensive'],
    'Motor Third Party Liability (TPL)':['Private Vehicle TPL','Commercial Vehicle TPL','Fleet TPL'],
    'Motor Comprehensive + TPL':['Private Vehicle Comprehensive + TPL','Commercial Vehicle Comprehensive + TPL','Fleet Comprehensive + TPL'],
    'Online Policy':['Online']}},
 'General':{
  'Property':{'Property All Risk':['Buildings & Contents','Commercial Property','Industrial Property'],'Fire & Allied Perils':['Standard Fire & Allied Perils'],
    'Business Interruption':['Gross Profit','Loss of Rent'],'Industrial All Risks':['Industrial All Risks'],'Home Insurance':['Home Building','Home Contents','Home Combined'],
    'Burglary / Theft':['Burglary / Theft'],'Money Insurance':['Money in Transit','Money in Safe'],'Fine Art Insurance':['Fine Art','Collections']},
  'Liability':{'Public Liability':['General Public Liability','Event Public Liability'],'General Liability / CGL':['Commercial General Liability'],'Product Liability':['Product Liability'],
    "Employers' Liability":["Employers' Liability"],"Workmen's Compensation":['Standard WC',"WC + Employers' Liability"],
    'Professional Indemnity (PI)':['Consultants PI','Accountants PI','Lawyers PI','Architects & Engineers PI','Other PI'],'Directors & Officers (D&O)':['Private Company D&O','Public Company D&O'],
    'Medical Malpractice':['Doctors','Clinics & Hospitals','Medical Professionals'],'Errors & Omissions (E&O)':['Technology E&O','General E&O'],'Event Liability':['Event Liability'],
    'Media Liability':['Media Liability'],'Clinical Trials Liability':['Clinical Trials Liability'],'Terrorism Liability':['Terrorism Liability'],
    'Decennial / Inherent Defects Liability':['Decennial Liability','Inherent Defects Liability'],'Umbrella / Excess Liability':['Umbrella Liability','Excess Liability']},
  'Engineering':{'Contractors All Risk (CAR)':['CAR Project'],'Erection All Risk (EAR)':['EAR Project'],'Machinery Breakdown':['Machinery Breakdown'],'Electronic Equipment Insurance':['Electronic Equipment'],
    'Contractors Plant & Machinery':['CPM'],'Boiler & Pressure Vessel':['Boiler & Pressure Vessel'],'Deterioration of Stock':['Deterioration of Stock'],'Civil Engineering Completed Risks':['Completed Civil Engineering Risks']},
  'Marine':{'Marine Cargo':['Single Transit','Annual Open Cover'],'Marine Hull':['Commercial Hull','Pleasure Craft / Yacht'],'Inland Transit':['Road / Inland Transit'],'Open Cover':['Marine Open Cover'],
    'Protection & Indemnity (P&I)':['P&I / Marine Liability'],'Charterers Liability':['Charterers Liability'],'Ports & Terminals Liability':['Ports & Terminals Liability'],
    'Yacht / Pleasure Craft':['Yacht','Pleasure Craft'],'Stock Throughput':['Stock Throughput']},
  'Travel':{'Individual Travel':['Single Trip','Annual Multi-Trip'],'Family Travel':['Single Trip Family','Annual Family'],'Group Travel':['Group Travel'],'Corporate Travel':['Corporate Annual Travel']},
  'Personal Accident':{'Individual Personal Accident':['Individual PA'],'Group Personal Accident':['Group PA']},
  'Life':{'Group Life':['Group Term Life','Group Credit Life'],'Credit Life':['Credit Life'],'Individual Life':['Individual Life'],'Term Life':['Term Life'],'Whole Life':['Whole Life'],'Critical Illness':['Critical Illness']},
  'Cyber':{'Cyber Insurance':['Cyber Package'],'Cyber Liability':['Cyber Liability'],'Cyber Crime':['Cyber Crime'],'Technology E&O':['Technology Errors & Omissions']},
  'Financial Lines':{'Bankers Blanket Bond':['BBB'],'Commercial Crime':['Commercial Crime'],'Fidelity Guarantee':['Fidelity Guarantee'],'Financial Institutions PI':['Financial Institutions PI'],'Investment Managers Insurance':['Investment Managers Insurance']},
  'Trade Credit & Political Risk':{'Trade Credit Insurance':['Domestic Trade Credit','Export Trade Credit'],'Political Risk Insurance':['Political Risk'],'Surety / Bonds':['Bid Bond','Performance Bond','Advance Payment Bond','Other Surety']},
  'Aviation':{'Aircraft Hull & Liability':['Aircraft Hull','Aircraft Liability'],'Aviation Liability':['Aviation Liability'],'Airport Liability':['Airport Liability'],'Aviation Products Liability':['Aviation Products Liability'],
    'Hangarkeepers Liability':['Hangarkeepers Liability'],'Drone / UAV Insurance':['Drone Hull','Drone Liability']},
  'Energy':{'Oil & Gas Onshore':['Upstream Onshore','Downstream Onshore'],'Oil & Gas Offshore':['Offshore Energy'],'Renewable Energy':['Solar','Wind','Other Renewable'],'Power & Utilities':['Power Generation','Utilities'],'Energy Liability':['Energy Liability']},
  'Miscellaneous':{'Jewellers Block':['Retail Jewellers','Wholesale Jewellers'],'Event Insurance':['Event Cancellation','Event Property / Liability'],'Wedding Insurance':['Wedding Insurance'],'Kidnap & Ransom / Special Contingency':['Kidnap & Ransom','Special Contingency']}
 }};
TAX.Motor.Motor['Online Policy']=[].concat(TAX.Motor.Motor['Motor Comprehensive'],TAX.Motor.Motor['Motor Third Party Liability (TPL)'],TAX.Motor.Motor['Motor Comprehensive + TPL']);
if(typeof module!=='undefined')module.exports=TAX;
